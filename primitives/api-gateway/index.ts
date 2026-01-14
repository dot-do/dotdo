/**
 * @module api-gateway
 *
 * API Gateway Primitive - A comprehensive edge-native API gateway for the dotdo platform.
 *
 * Provides request routing, middleware chains, rate limiting, CORS handling, and
 * authentication for building secure, scalable API endpoints on Cloudflare Workers.
 *
 * ## Features
 *
 * - **Express-style routing** with path parameters and wildcards
 * - **Middleware chains** with before/after hooks for request transformation
 * - **Rate limiting** with sliding window algorithm and per-route configuration
 * - **CORS handling** with configurable origins, methods, and headers
 * - **Authentication** supporting JWT and API key validation
 * - **Route grouping** for modular API organization
 * - **Fluent response builder** for consistent API responses
 *
 * @example Basic API Gateway
 * ```typescript
 * import { APIGateway, ResponseBuilder } from 'dotdo/primitives/api-gateway'
 *
 * const gateway = new APIGateway({
 *   basePath: '/api/v1',
 *   cors: {
 *     origins: ['https://app.example.com'],
 *     methods: ['GET', 'POST', 'PUT', 'DELETE'],
 *     headers: ['Content-Type', 'Authorization'],
 *   },
 * })
 *
 * gateway.route('GET', '/users/:id', async (request) => {
 *   const user = await getUser(request.params.id)
 *   return ResponseBuilder.ok(user)
 * })
 *
 * gateway.route('POST', '/users', createUserHandler, [validationMiddleware], {
 *   requests: 10,
 *   window: 60000, // 10 requests per minute
 * })
 *
 * // Handle incoming request
 * const response = await gateway.handle(request)
 * ```
 *
 * @example Route Groups with Shared Middleware
 * ```typescript
 * gateway.group('/admin', [
 *   { method: 'GET', path: '/users', handler: listUsers },
 *   { method: 'DELETE', path: '/users/:id', handler: deleteUser },
 * ], [adminAuthMiddleware])
 * ```
 *
 * @example Custom Middleware
 * ```typescript
 * const loggingMiddleware: Middleware = {
 *   before: async (request) => {
 *     console.log(`${request.method} ${request.path}`)
 *     return request
 *   },
 *   after: async (request, response) => {
 *     console.log(`Response: ${response.status}`)
 *     return response
 *   },
 * }
 *
 * gateway.use(loggingMiddleware)
 * ```
 *
 * @packageDocumentation
 */

import type {
  HTTPMethod,
  Route,
  RouteMatch,
  RouteHandler,
  Middleware,
  APIRequest,
  APIResponse,
  RateLimitConfig,
  CORSConfig,
  AuthConfig,
  APIGatewayConfig,
  AuthResult
} from './types'

export * from './types'

/**
 * Main API Gateway class
 */
export class APIGateway {
  private config: APIGatewayConfig
  private router: Router
  private globalMiddleware: Middleware[] = []
  private rateLimiter: RateLimiter
  private corsHandler?: CORSHandler
  private authMiddleware?: AuthMiddleware

  constructor(config?: APIGatewayConfig) {
    this.config = config || {}
    this.router = new Router()
    this.rateLimiter = new RateLimiter()

    if (config?.cors) {
      this.corsHandler = new CORSHandler(config.cors)
    }

    if (config?.auth) {
      this.authMiddleware = new AuthMiddleware(config.auth)
    }

    if (config?.middleware) {
      this.globalMiddleware = [...config.middleware]
    }
  }

  route(method: HTTPMethod, path: string, handler: RouteHandler, middleware?: Middleware[], rateLimit?: RateLimitConfig): void {
    const fullPath = this.config.basePath ? `${this.config.basePath}${path}` : path
    const route: Route = {
      method,
      path: fullPath,
      handler,
      middleware,
      rateLimit
    }
    this.router.add(method, fullPath, route)
  }

  use(middleware: Middleware): void {
    this.globalMiddleware.push(middleware)
  }

  async handle(request: APIRequest): Promise<APIResponse> {
    try {
      const origin = request.headers['Origin'] || request.headers['origin']

      // Handle CORS preflight
      if (request.method === 'OPTIONS' && this.corsHandler && origin) {
        const preflightHeaders = this.corsHandler.getPreflightHeaders(origin)
        if (Object.keys(preflightHeaders).length > 0) {
          return { status: 204, headers: preflightHeaders, body: undefined }
        }
        // Disallowed origin for preflight
        return { status: 204, headers: {}, body: undefined }
      }

      // Authentication
      if (this.authMiddleware) {
        const authResult = await this.authMiddleware.authenticate(request)
        if (!authResult.valid) {
          return { status: 401, headers: {}, body: { error: 'Unauthorized' } }
        }
        // Attach user to context
        if (authResult.user) {
          request = {
            ...request,
            context: { ...request.context, user: authResult.user }
          }
        }
      }

      // Parse query from path
      const [pathname, queryString] = request.path.split('?')
      const query = this.parseQueryString(queryString || '')

      // Match route
      const match = this.router.match(request.method as HTTPMethod, request.path)

      if (!match) {
        return { status: 404, headers: {}, body: { error: 'Not Found' } }
      }

      // Merge params and query into request
      const enhancedRequest: APIRequest = {
        ...request,
        params: match.params,
        query: match.query
      }

      // Check rate limit
      if (match.route.rateLimit) {
        const config = match.route.rateLimit
        const key = this.getRateLimitKey(config, enhancedRequest)
        const allowed = this.rateLimiter.check(key, config)

        if (!allowed) {
          return { status: 429, headers: {}, body: { error: 'Too Many Requests' } }
        }

        // Add rate limit headers
        const remaining = this.rateLimiter.remaining(key, config)
        const rateLimitHeaders: Record<string, string> = {
          'X-RateLimit-Limit': String(config.requests),
          'X-RateLimit-Remaining': String(remaining)
        }

        // Continue processing but include rate limit headers in response
        const response = await this.processRequest(enhancedRequest, match)
        return {
          ...response,
          headers: { ...response.headers, ...rateLimitHeaders }
        }
      }

      // Process request
      const response = await this.processRequest(enhancedRequest, match)

      // Add CORS headers
      if (this.corsHandler && origin) {
        const corsHeaders = this.corsHandler.getCORSHeaders(origin)
        return {
          ...response,
          headers: { ...response.headers, ...corsHeaders }
        }
      }

      return response
    } catch (error) {
      return { status: 500, headers: {}, body: { error: 'Internal Server Error' } }
    }
  }

  private async processRequest(request: APIRequest, match: RouteMatch): Promise<APIResponse> {
    // Combine global and route-specific middleware
    const allMiddleware = [
      ...this.globalMiddleware,
      ...(match.route.middleware || [])
    ]

    const chain = new MiddlewareChain(allMiddleware)

    // Execute before middleware
    const beforeResult = await chain.executeBefore(request)

    // If middleware returned a response (short-circuit), return it
    if ('status' in beforeResult) {
      return beforeResult as APIResponse
    }

    // Execute handler
    const response = await match.route.handler(beforeResult as APIRequest)

    // Execute after middleware
    return chain.executeAfter(beforeResult as APIRequest, response)
  }

  group(prefix: string, routes: Array<{ method: HTTPMethod; path: string; handler: RouteHandler; middleware?: Middleware[]; rateLimit?: RateLimitConfig }>, middleware?: Middleware[]): void {
    for (const routeConfig of routes) {
      const fullPath = `${prefix}${routeConfig.path}`
      const combinedMiddleware = [
        ...(middleware || []),
        ...(routeConfig.middleware || [])
      ]
      this.route(
        routeConfig.method,
        fullPath,
        routeConfig.handler,
        combinedMiddleware.length > 0 ? combinedMiddleware : undefined,
        routeConfig.rateLimit
      )
    }
  }

  private getRateLimitKey(config: RateLimitConfig, request: APIRequest): string {
    if (typeof config.key === 'function') {
      return config.key(request)
    }

    if (config.key === 'ip') {
      return request.headers['X-Forwarded-For'] ||
             request.headers['x-forwarded-for'] ||
             'unknown'
    }

    return config.key
  }

  private parseQueryString(queryString: string): Record<string, string> {
    if (!queryString) return {}

    const params: Record<string, string> = {}
    const pairs = queryString.split('&')

    for (const pair of pairs) {
      const [key, value] = pair.split('=')
      if (key) {
        params[decodeURIComponent(key)] = decodeURIComponent(value || '')
      }
    }

    return params
  }
}

/**
 * Router for path matching
 */
export class Router {
  private routes: Route[] = []

  add(method: HTTPMethod, path: string, route: Route): void {
    this.routes.push({ ...route, method, path })
  }

  match(method: HTTPMethod, path: string): RouteMatch | null {
    // Parse query string from path
    const [pathname, queryString] = path.split('?')
    const query = this.parseQueryString(queryString || '')

    // Try to find a matching route
    for (const route of this.routes) {
      if (route.method !== method) continue

      const params = this.matchPath(route.path, pathname)
      if (params !== null) {
        return { route, params, query }
      }
    }

    return null
  }

  private matchPath(routePath: string, requestPath: string): Record<string, string> | null {
    const routeParts = routePath.split('/').filter(Boolean)
    const requestParts = requestPath.split('/').filter(Boolean)

    // Handle wildcard at end
    const hasWildcard = routeParts[routeParts.length - 1] === '*'

    // If no wildcard, lengths must match
    if (!hasWildcard && routeParts.length !== requestParts.length) {
      return null
    }

    // If has wildcard, request must be at least as long as route (minus wildcard)
    if (hasWildcard && requestParts.length < routeParts.length - 1) {
      return null
    }

    const params: Record<string, string> = {}

    for (let i = 0; i < routeParts.length; i++) {
      const routePart = routeParts[i]

      // Wildcard captures rest of path
      if (routePart === '*') {
        params['*'] = requestParts.slice(i).join('/')
        return params
      }

      const requestPart = requestParts[i]

      // Parameter capture
      if (routePart.startsWith(':')) {
        const paramName = routePart.slice(1)
        params[paramName] = requestPart
        continue
      }

      // Exact match required
      if (routePart !== requestPart) {
        return null
      }
    }

    return params
  }

  private parseQueryString(queryString: string): Record<string, string> {
    if (!queryString) return {}

    const params: Record<string, string> = {}
    const pairs = queryString.split('&')

    for (const pair of pairs) {
      const [key, value] = pair.split('=')
      if (key) {
        params[decodeURIComponent(key)] = decodeURIComponent(value || '')
      }
    }

    return params
  }
}

/**
 * Middleware chain executor
 */
export class MiddlewareChain {
  private middleware: Middleware[]

  constructor(middleware: Middleware[]) {
    this.middleware = middleware
  }

  async executeBefore(request: APIRequest): Promise<APIRequest | APIResponse> {
    let currentRequest = request

    for (const mw of this.middleware) {
      if (mw.before) {
        const result = await mw.before(currentRequest)
        // If result has status, it's a response (short-circuit)
        if (result && 'status' in result) {
          return result as APIResponse
        }
        currentRequest = result as APIRequest
      }
    }

    return currentRequest
  }

  async executeAfter(request: APIRequest, response: APIResponse): Promise<APIResponse> {
    let currentResponse = response

    // Execute after middleware in reverse order
    for (let i = this.middleware.length - 1; i >= 0; i--) {
      const mw = this.middleware[i]
      if (mw.after) {
        currentResponse = await mw.after(request, currentResponse)
      }
    }

    return currentResponse
  }
}

/**
 * Rate limiter with sliding window
 */
export class RateLimiter {
  private buckets: Map<string, { count: number; windowStart: number }> = new Map()

  check(key: string, config: RateLimitConfig): boolean {
    const now = Date.now()
    const bucket = this.buckets.get(key)

    if (!bucket || now - bucket.windowStart >= config.window) {
      // Start new window
      this.buckets.set(key, { count: 1, windowStart: now })
      return true
    }

    if (bucket.count >= config.requests) {
      return false
    }

    bucket.count++
    return true
  }

  remaining(key: string, config: RateLimitConfig): number {
    const bucket = this.buckets.get(key)
    if (!bucket) return config.requests
    return Math.max(0, config.requests - bucket.count)
  }
}

/**
 * CORS handler
 */
export class CORSHandler {
  private config: CORSConfig

  constructor(config: CORSConfig) {
    this.config = config
  }

  isOriginAllowed(origin: string): boolean {
    if (this.config.origins === '*') return true
    return this.config.origins.includes(origin)
  }

  getPreflightHeaders(origin: string): Record<string, string> {
    const headers: Record<string, string> = {}

    if (this.isOriginAllowed(origin)) {
      headers['Access-Control-Allow-Origin'] = this.config.origins === '*' ? '*' : origin
      headers['Access-Control-Allow-Methods'] = this.config.methods.join(', ')
      headers['Access-Control-Allow-Headers'] = this.config.headers.join(', ')

      if (this.config.maxAge) {
        headers['Access-Control-Max-Age'] = String(this.config.maxAge)
      }

      if (this.config.credentials) {
        headers['Access-Control-Allow-Credentials'] = 'true'
      }

      if (this.config.exposedHeaders?.length) {
        headers['Access-Control-Expose-Headers'] = this.config.exposedHeaders.join(', ')
      }
    }

    return headers
  }

  getCORSHeaders(origin: string): Record<string, string> {
    const headers: Record<string, string> = {}

    if (this.isOriginAllowed(origin)) {
      headers['Access-Control-Allow-Origin'] = this.config.origins === '*' ? '*' : origin

      if (this.config.credentials) {
        headers['Access-Control-Allow-Credentials'] = 'true'
      }

      if (this.config.exposedHeaders?.length) {
        headers['Access-Control-Expose-Headers'] = this.config.exposedHeaders.join(', ')
      }
    }

    return headers
  }
}

/**
 * Authentication middleware
 */
export class AuthMiddleware {
  private config: AuthConfig

  constructor(config: AuthConfig) {
    this.config = config
  }

  async authenticate(request: APIRequest): Promise<AuthResult> {
    const token = this.extractToken(request)

    if (!token) {
      return { valid: false, error: 'Missing authorization token' }
    }

    const result = await this.config.validate(token, request)

    // Handle boolean or AuthResult return
    if (typeof result === 'boolean') {
      return { valid: result }
    }

    return result
  }

  private extractToken(request: APIRequest): string | null {
    if (this.config.type === 'jwt') {
      const authHeader = request.headers['Authorization'] || request.headers['authorization']
      if (!authHeader) return null

      const scheme = this.config.scheme || 'Bearer'
      const prefix = `${scheme} `

      if (authHeader.startsWith(prefix)) {
        return authHeader.slice(prefix.length)
      }
      return null
    }

    if (this.config.type === 'api-key') {
      const headerName = this.config.header || 'X-API-Key'
      return request.headers[headerName] || request.headers[headerName.toLowerCase()] || null
    }

    // Custom type - use Authorization header by default
    return request.headers['Authorization'] || request.headers['authorization'] || null
  }
}

/**
 * Fluent response builder
 */
export class ResponseBuilder {
  private _status: number = 200
  private _headers: Record<string, string> = {}
  private _body: unknown = undefined

  status(code: number): ResponseBuilder {
    this._status = code
    return this
  }

  header(name: string, value: string): ResponseBuilder {
    this._headers[name] = value
    return this
  }

  json(body: unknown): ResponseBuilder {
    this._body = body
    this._headers['Content-Type'] = 'application/json'
    return this
  }

  text(body: string): ResponseBuilder {
    this._body = body
    this._headers['Content-Type'] = 'text/plain'
    return this
  }

  build(): APIResponse {
    return {
      status: this._status,
      headers: this._headers,
      body: this._body
    }
  }

  static ok(body?: unknown): APIResponse {
    return {
      status: 200,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body
    }
  }

  static created(body?: unknown): APIResponse {
    return {
      status: 201,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body
    }
  }

  static noContent(): APIResponse {
    return {
      status: 204,
      headers: {},
      body: undefined
    }
  }

  static badRequest(message?: string): APIResponse {
    return {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: { error: message || 'Bad Request' }
    }
  }

  static unauthorized(message?: string): APIResponse {
    return {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
      body: { error: message || 'Unauthorized' }
    }
  }

  static forbidden(message?: string): APIResponse {
    return {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
      body: { error: message || 'Forbidden' }
    }
  }

  static notFound(message?: string): APIResponse {
    return {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
      body: { error: message || 'Not Found' }
    }
  }

  static serverError(message?: string): APIResponse {
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { error: message || 'Internal Server Error' }
    }
  }
}
