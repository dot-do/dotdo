/**
 * @dotdo/cubejs - REST and GraphQL API Compatible Endpoints
 *
 * Provides a Cube.js-compatible REST and GraphQL API that can be used with
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
 *
 * // REST endpoints:
 * // GET/POST /cubejs-api/v1/load - Execute query
 * // POST /cubejs-api/v1/sql - Generate SQL
 * // GET /cubejs-api/v1/meta - Get schema metadata
 * // POST /cubejs-api/v1/dry-run - Validate query
 *
 * // GraphQL endpoint:
 * // POST /cubejs-api/graphql - GraphQL queries
 * ```
 */

import type { CubeSchema, Measure, Dimension, Granularity } from './schema'
import type { CubeQuery, Filter, TimeDimension } from './query'
import { normalizeQuery, getQueryCubes, validateQueryMembers } from './query'
import { AuthenticationError, QueryError, ValidationError } from './errors'
import { generateSQL } from './sql'
import {
  QueryResultCache,
  type QueryResultCacheOptions,
  type CacheStatistics,
} from './cache'

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
 * Cache configuration for CubeAPI
 */
export interface CacheOptions extends QueryResultCacheOptions {
  /**
   * Enable query result caching
   * @default false
   */
  enabled?: boolean
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

  /**
   * Cache configuration for query results
   */
  cache?: CacheOptions
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

/**
 * GraphQL request body
 */
export interface GraphQLRequest {
  query: string
  variables?: Record<string, unknown>
  operationName?: string
}

/**
 * GraphQL response
 */
export interface GraphQLResponse {
  data?: unknown
  errors?: Array<{
    message: string
    locations?: Array<{ line: number; column: number }>
    path?: (string | number)[]
  }>
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
  private queryCache?: QueryResultCache

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

    // Initialize cache if enabled
    if (options.cache?.enabled) {
      this.queryCache = new QueryResultCache({
        ttl: options.cache.ttl,
        maxEntries: options.cache.maxEntries,
        lru: options.cache.lru,
      })
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStatistics | undefined {
    return this.queryCache?.getStats()
  }

  /**
   * Invalidate cache entries for a cube
   */
  async invalidateCache(cubeName?: string): Promise<void> {
    if (!this.queryCache) return
    if (cubeName) {
      await this.queryCache.invalidatePattern(cubeName)
    } else {
      await this.queryCache.clear()
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

      // /load endpoint - supports both GET and POST
      if (path === `${basePath}/load`) {
        if (request.method === 'POST') {
          const result = await this.handleLoad(request, securityContext)
          return this.jsonResponse(result, corsHeaders)
        }
        if (request.method === 'GET') {
          const result = await this.handleLoadGet(url, securityContext)
          return this.jsonResponse(result, corsHeaders)
        }
      }

      // /sql endpoint - supports both GET and POST
      if (path === `${basePath}/sql`) {
        if (request.method === 'POST') {
          const result = await this.handleSQL(request, securityContext)
          return this.jsonResponse(result, corsHeaders)
        }
        if (request.method === 'GET') {
          const result = await this.handleSQLGet(url, securityContext)
          return this.jsonResponse(result, corsHeaders)
        }
      }

      if (path === `${basePath}/meta` && request.method === 'GET') {
        const result = await this.handleMeta()
        return this.jsonResponse(result, corsHeaders)
      }

      // /dry-run endpoint - supports both GET and POST
      if (path === `${basePath}/dry-run`) {
        if (request.method === 'POST') {
          const result = await this.handleDryRun(request, securityContext)
          return this.jsonResponse(result, corsHeaders)
        }
        if (request.method === 'GET') {
          const result = await this.handleDryRunGet(url, securityContext)
          return this.jsonResponse(result, corsHeaders)
        }
      }

      // GraphQL endpoint
      if (path === '/cubejs-api/graphql' || path === `${basePath.replace('/v1', '')}/graphql`) {
        if (request.method === 'POST') {
          const result = await this.handleGraphQL(request, securityContext)
          return this.jsonResponse(result, corsHeaders)
        }
        if (request.method === 'GET') {
          const result = await this.handleGraphQLGet(url, securityContext)
          return this.jsonResponse(result, corsHeaders)
        }
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

    // Check cache first (unless renewQuery is set)
    if (this.queryCache && !normalizedQuery.renewQuery) {
      const cacheKey = this.queryCache.generateKey(normalizedQuery, securityContext)
      const cached = await this.queryCache.get(cacheKey)
      if (cached) {
        return {
          ...cached,
          requestId: this.generateRequestId(),
        }
      }
    }

    // Generate SQL
    const sql = generateSQL(normalizedQuery, this.schemas)

    // Execute query
    let data: unknown[] = []
    if (this.options.dataSource) {
      data = await this.options.dataSource(normalizedQuery, sql, securityContext)
    }

    // Build annotation
    const annotation = this.buildAnnotation(normalizedQuery)

    const result: QueryResult = {
      data,
      annotation,
      query: normalizedQuery,
      lastRefreshTime: new Date().toISOString(),
      requestId: this.generateRequestId(),
    }

    // Cache result
    if (this.queryCache && !normalizedQuery.renewQuery) {
      const cacheKey = this.queryCache.generateKey(normalizedQuery, securityContext)
      await this.queryCache.set(cacheKey, {
        data: result.data,
        annotation: result.annotation,
        query: result.query,
        lastRefreshTime: result.lastRefreshTime,
      })
    }

    return result
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

  /**
   * Handle GET /load endpoint - query passed as URL parameter
   */
  private async handleLoadGet(
    url: URL,
    securityContext?: SecurityContext
  ): Promise<QueryResult> {
    const queryParam = url.searchParams.get('query')
    if (!queryParam) {
      throw new ValidationError('Missing query parameter')
    }

    let query: CubeQuery
    try {
      query = JSON.parse(queryParam)
    } catch {
      throw new ValidationError('Invalid query JSON')
    }

    return this.executeQuery(query, securityContext)
  }

  /**
   * Handle GET /sql endpoint
   */
  private async handleSQLGet(
    url: URL,
    securityContext?: SecurityContext
  ): Promise<SQLResponse> {
    const queryParam = url.searchParams.get('query')
    if (!queryParam) {
      throw new ValidationError('Missing query parameter')
    }

    let query: CubeQuery
    try {
      query = JSON.parse(queryParam)
    } catch {
      throw new ValidationError('Invalid query JSON')
    }

    return this.generateSQLResponse(query, securityContext)
  }

  /**
   * Handle GET /dry-run endpoint
   */
  private async handleDryRunGet(
    url: URL,
    securityContext?: SecurityContext
  ): Promise<DryRunResponse> {
    const queryParam = url.searchParams.get('query')
    if (!queryParam) {
      throw new ValidationError('Missing query parameter')
    }

    let query: CubeQuery
    try {
      query = JSON.parse(queryParam)
    } catch {
      throw new ValidationError('Invalid query JSON')
    }

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

  /**
   * Handle POST /graphql endpoint
   */
  private async handleGraphQL(
    request: Request,
    securityContext?: SecurityContext
  ): Promise<GraphQLResponse> {
    const body = await request.json() as GraphQLRequest
    return this.executeGraphQL(body, securityContext)
  }

  /**
   * Handle GET /graphql endpoint
   */
  private async handleGraphQLGet(
    url: URL,
    securityContext?: SecurityContext
  ): Promise<GraphQLResponse> {
    const query = url.searchParams.get('query')
    if (!query) {
      return {
        errors: [{ message: 'Missing query parameter' }],
      }
    }

    const variablesParam = url.searchParams.get('variables')
    let variables: Record<string, unknown> | undefined
    if (variablesParam) {
      try {
        variables = JSON.parse(variablesParam)
      } catch {
        return {
          errors: [{ message: 'Invalid variables JSON' }],
        }
      }
    }

    const operationName = url.searchParams.get('operationName') || undefined

    return this.executeGraphQL({ query, variables, operationName }, securityContext)
  }

  /**
   * Execute a GraphQL query
   */
  private async executeGraphQL(
    request: GraphQLRequest,
    securityContext?: SecurityContext
  ): Promise<GraphQLResponse> {
    try {
      const { query: graphqlQuery, variables, operationName } = request

      // Parse the GraphQL query to extract cube query
      const cubeQuery = this.parseGraphQLToCubeQuery(graphqlQuery, variables)

      if (!cubeQuery) {
        return {
          errors: [{ message: 'Unable to parse GraphQL query' }],
        }
      }

      // Execute the query
      const result = await this.executeQuery(cubeQuery, securityContext)

      // Format response for GraphQL
      return {
        data: {
          cube: result.data,
          annotation: result.annotation,
        },
      }
    } catch (error) {
      return {
        errors: [{
          message: error instanceof Error ? error.message : 'Unknown error',
        }],
      }
    }
  }

  /**
   * Parse a GraphQL query into a Cube.js query
   * Supports the Cube.js GraphQL schema format
   */
  private parseGraphQLToCubeQuery(
    graphqlQuery: string,
    variables?: Record<string, unknown>
  ): CubeQuery | null {
    const cubeQuery: CubeQuery = {}

    // Extract cube query from GraphQL
    // Cube.js uses a format like: cube(measures: [...], dimensions: [...])
    const cubeMatch = graphqlQuery.match(/cube\s*\(([^)]+)\)/)
    if (!cubeMatch) {
      // Try to parse as a simpler query format
      return this.parseSimpleGraphQL(graphqlQuery, variables)
    }

    const argsStr = cubeMatch[1]

    // Extract measures
    const measuresMatch = argsStr.match(/measures:\s*\[([^\]]*)\]/)
    if (measuresMatch) {
      cubeQuery.measures = this.extractGraphQLArray(measuresMatch[1], variables)
    }

    // Extract dimensions
    const dimensionsMatch = argsStr.match(/dimensions:\s*\[([^\]]*)\]/)
    if (dimensionsMatch) {
      cubeQuery.dimensions = this.extractGraphQLArray(dimensionsMatch[1], variables)
    }

    // Extract segments
    const segmentsMatch = argsStr.match(/segments:\s*\[([^\]]*)\]/)
    if (segmentsMatch) {
      cubeQuery.segments = this.extractGraphQLArray(segmentsMatch[1], variables)
    }

    // Extract limit
    const limitMatch = argsStr.match(/limit:\s*(\d+)/)
    if (limitMatch) {
      cubeQuery.limit = parseInt(limitMatch[1], 10)
    }

    // Extract offset
    const offsetMatch = argsStr.match(/offset:\s*(\d+)/)
    if (offsetMatch) {
      cubeQuery.offset = parseInt(offsetMatch[1], 10)
    }

    // Extract timezone
    const timezoneMatch = argsStr.match(/timezone:\s*"([^"]*)"/)
    if (timezoneMatch) {
      cubeQuery.timezone = timezoneMatch[1]
    }

    // Extract filters
    const filtersMatch = argsStr.match(/filters:\s*(\[[^\]]*\]|\$\w+)/)
    if (filtersMatch) {
      cubeQuery.filters = this.parseGraphQLFilters(filtersMatch[1], variables)
    }

    // Extract timeDimensions
    const timeDimensionsMatch = argsStr.match(/timeDimensions:\s*(\[[^\]]*\]|\$\w+)/)
    if (timeDimensionsMatch) {
      cubeQuery.timeDimensions = this.parseGraphQLTimeDimensions(timeDimensionsMatch[1], variables)
    }

    return cubeQuery
  }

  /**
   * Parse a simple GraphQL query format
   */
  private parseSimpleGraphQL(
    query: string,
    variables?: Record<string, unknown>
  ): CubeQuery | null {
    // Check for query variables
    if (variables && variables.query) {
      return variables.query as CubeQuery
    }

    // Try to extract from a load query format
    const loadMatch = query.match(/load\s*\(\s*query:\s*(\$\w+)\s*\)/)
    if (loadMatch && variables) {
      const varName = loadMatch[1].slice(1) // Remove $
      if (variables[varName]) {
        return variables[varName] as CubeQuery
      }
    }

    // Check for inline query object
    const queryObjMatch = query.match(/query:\s*(\{[^}]+\})/)
    if (queryObjMatch) {
      try {
        // Replace single quotes with double quotes for JSON parsing
        const jsonStr = queryObjMatch[1]
          .replace(/'/g, '"')
          .replace(/(\w+):/g, '"$1":')
        return JSON.parse(jsonStr) as CubeQuery
      } catch {
        return null
      }
    }

    return null
  }

  /**
   * Extract an array of strings from GraphQL array syntax
   */
  private extractGraphQLArray(
    content: string,
    variables?: Record<string, unknown>
  ): string[] {
    // Check if it's a variable reference
    if (content.trim().startsWith('$')) {
      const varName = content.trim().slice(1)
      const value = variables?.[varName]
      if (Array.isArray(value)) {
        return value as string[]
      }
      return []
    }

    // Parse array content
    const items: string[] = []
    const regex = /"([^"]+)"|'([^']+)'|(\w+\.\w+)/g
    let match

    while ((match = regex.exec(content)) !== null) {
      items.push(match[1] || match[2] || match[3])
    }

    return items
  }

  /**
   * Parse GraphQL filters
   */
  private parseGraphQLFilters(
    content: string,
    variables?: Record<string, unknown>
  ): Filter[] {
    // Check if it's a variable reference
    if (content.trim().startsWith('$')) {
      const varName = content.trim().slice(1)
      const value = variables?.[varName]
      if (Array.isArray(value)) {
        return value as Filter[]
      }
      return []
    }

    // Parse inline filters
    const filters: Filter[] = []
    const filterRegex = /\{\s*member:\s*"([^"]+)"\s*,\s*operator:\s*"([^"]+)"(?:\s*,\s*values:\s*\[([^\]]*)\])?\s*\}/g
    let match

    while ((match = filterRegex.exec(content)) !== null) {
      const filter: Filter = {
        member: match[1],
        operator: match[2] as Filter['operator'],
      }

      if (match[3]) {
        filter.values = this.extractGraphQLArray(match[3], variables)
      }

      filters.push(filter)
    }

    return filters
  }

  /**
   * Parse GraphQL time dimensions
   */
  private parseGraphQLTimeDimensions(
    content: string,
    variables?: Record<string, unknown>
  ): TimeDimension[] {
    // Check if it's a variable reference
    if (content.trim().startsWith('$')) {
      const varName = content.trim().slice(1)
      const value = variables?.[varName]
      if (Array.isArray(value)) {
        return value as TimeDimension[]
      }
      return []
    }

    // Parse inline time dimensions
    const timeDimensions: TimeDimension[] = []
    const tdRegex = /\{\s*dimension:\s*"([^"]+)"(?:\s*,\s*granularity:\s*"([^"]+)")?(?:\s*,\s*dateRange:\s*(\[[^\]]*\]|"[^"]+"))?\s*\}/g
    let match

    while ((match = tdRegex.exec(content)) !== null) {
      const td: TimeDimension = {
        dimension: match[1],
      }

      if (match[2]) {
        td.granularity = match[2] as Granularity
      }

      if (match[3]) {
        // Parse date range
        const dateRangeStr = match[3]
        if (dateRangeStr.startsWith('[')) {
          // Array format
          const dates = this.extractGraphQLArray(dateRangeStr.slice(1, -1), variables)
          if (dates.length === 2) {
            td.dateRange = [dates[0], dates[1]]
          }
        } else {
          // String format (relative date range)
          td.dateRange = dateRangeStr.slice(1, -1) // Remove quotes
        }
      }

      timeDimensions.push(td)
    }

    return timeDimensions
  }

  /**
   * Execute a cube query (shared logic for GET and POST)
   */
  private async executeQuery(
    query: CubeQuery,
    securityContext?: SecurityContext
  ): Promise<QueryResult> {
    // Validate query
    this.validateQuery(query)

    // Transform query
    if (this.options.queryTransformer) {
      query = this.options.queryTransformer(query, securityContext)
    }

    // Normalize query
    const normalizedQuery = normalizeQuery(query)

    // Check cache first (unless renewQuery is set)
    if (this.queryCache && !normalizedQuery.renewQuery) {
      const cacheKey = this.queryCache.generateKey(normalizedQuery, securityContext)
      const cached = await this.queryCache.get(cacheKey)
      if (cached) {
        return {
          ...cached,
          requestId: this.generateRequestId(),
        }
      }
    }

    // Generate SQL
    const sql = generateSQL(normalizedQuery, this.schemas)

    // Execute query
    let data: unknown[] = []
    if (this.options.dataSource) {
      data = await this.options.dataSource(normalizedQuery, sql, securityContext)
    }

    // Build annotation
    const annotation = this.buildAnnotation(normalizedQuery)

    const result: QueryResult = {
      data,
      annotation,
      query: normalizedQuery,
      lastRefreshTime: new Date().toISOString(),
      requestId: this.generateRequestId(),
    }

    // Cache result
    if (this.queryCache && !normalizedQuery.renewQuery) {
      const cacheKey = this.queryCache.generateKey(normalizedQuery, securityContext)
      await this.queryCache.set(cacheKey, {
        data: result.data,
        annotation: result.annotation,
        query: result.query,
        lastRefreshTime: result.lastRefreshTime,
      })
    }

    return result
  }

  /**
   * Generate SQL response (shared logic)
   */
  private async generateSQLResponse(
    query: CubeQuery,
    securityContext?: SecurityContext
  ): Promise<SQLResponse> {
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
