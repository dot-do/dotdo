/**
 * API - REST/GraphQL API platform
 *
 * Extends DigitalBusiness with API-specific OKRs: APICalls, Latency, ErrorRate.
 * Includes routing, rate limiting, authentication, CORS for developer platforms.
 *
 * Examples: 'api.acme.com/v1', 'graphql.acme.com'
 *
 * @example
 * ```typescript
 * class MyAPI extends API {
 *   // Inherits: Revenue, Costs, Profit, Traffic, Conversion, Engagement
 *   // Adds: APICalls, Latency, ErrorRate (developer platform metrics)
 * }
 * ```
 */

import { DigitalBusiness, DigitalBusinessConfig } from './DigitalBusiness'
import { Env } from './DO'
import type { OKR } from './DOBase'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  path: string
  handler: string
  middleware?: string[]
}

export interface APIConfig extends DigitalBusinessConfig {
  name: string
  description?: string
  version: string
  basePath: string
  routes: Route[]
  rateLimit?: {
    requests: number
    window: number // seconds
  }
  authentication?: {
    type: 'apiKey' | 'bearer' | 'basic'
    headerName?: string
  }
  cors?: {
    origins: string[]
    methods: string[]
    headers: string[]
  }
}

export interface RequestContext {
  method: string
  path: string
  params: Record<string, string>
  query: Record<string, string>
  headers: Record<string, string>
  body?: unknown
}

export interface RateLimitState {
  count: number
  resetAt: number
}

// ============================================================================
// API CLASS
// ============================================================================

export class API extends DigitalBusiness {
  static override readonly $type: string = 'API'

  private apiConfig: APIConfig | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * OKRs for API
   *
   * Includes inherited DigitalBusiness OKRs (Revenue, Costs, Profit, Traffic, Conversion, Engagement)
   * plus API-specific metrics (APICalls, Latency, ErrorRate)
   */
  override okrs: Record<string, OKR> = {
    // Inherited from Business (via DigitalBusiness)
    Revenue: this.defineOKR({
      objective: 'Grow revenue',
      keyResults: [
        { name: 'TotalRevenue', target: 100000, current: 0, unit: '$' },
        { name: 'RevenueGrowthRate', target: 20, current: 0, unit: '%' },
      ],
    }),
    Costs: this.defineOKR({
      objective: 'Optimize costs',
      keyResults: [
        { name: 'TotalCosts', target: 50000, current: 0, unit: '$' },
        { name: 'CostReduction', target: 10, current: 0, unit: '%' },
      ],
    }),
    Profit: this.defineOKR({
      objective: 'Maximize profit',
      keyResults: [
        { name: 'NetProfit', target: 50000, current: 0, unit: '$' },
        { name: 'ProfitMargin', target: 50, current: 0, unit: '%' },
      ],
    }),
    // Inherited from DigitalBusiness
    Traffic: this.defineOKR({
      objective: 'Increase website traffic',
      keyResults: [
        { name: 'MonthlyVisitors', target: 100000, current: 0 },
        { name: 'UniqueVisitors', target: 50000, current: 0 },
        { name: 'PageViews', target: 300000, current: 0 },
      ],
    }),
    Conversion: this.defineOKR({
      objective: 'Improve conversion rates',
      keyResults: [
        { name: 'VisitorToSignup', target: 10, current: 0, unit: '%' },
        { name: 'SignupToCustomer', target: 25, current: 0, unit: '%' },
        { name: 'OverallConversion', target: 2.5, current: 0, unit: '%' },
      ],
    }),
    Engagement: this.defineOKR({
      objective: 'Boost user engagement',
      keyResults: [
        { name: 'DAU', target: 10000, current: 0 },
        { name: 'MAU', target: 50000, current: 0 },
        { name: 'DAUMAURatio', target: 20, current: 0, unit: '%' },
        { name: 'SessionDuration', target: 300, current: 0, unit: 'seconds' },
      ],
    }),
    // API-specific OKRs
    APICalls: this.defineOKR({
      objective: 'Scale API usage',
      keyResults: [
        { name: 'TotalAPICalls', target: 10000000, current: 0 },
        { name: 'DailyAPICalls', target: 500000, current: 0 },
        { name: 'UniqueAPIClients', target: 10000, current: 0 },
        { name: 'RequestsPerSecond', target: 1000, current: 0, unit: 'req/s' },
      ],
    }),
    Latency: this.defineOKR({
      objective: 'Minimize API response time',
      keyResults: [
        { name: 'AvgLatency', target: 50, current: 0, unit: 'ms' },
        { name: 'P50Latency', target: 30, current: 0, unit: 'ms' },
        { name: 'P95Latency', target: 100, current: 0, unit: 'ms' },
        { name: 'P99Latency', target: 200, current: 0, unit: 'ms' },
      ],
    }),
    ErrorRate: this.defineOKR({
      objective: 'Maximize API reliability',
      keyResults: [
        { name: 'TotalErrorRate', target: 0.1, current: 0, unit: '%' },
        { name: '4xxErrorRate', target: 1, current: 0, unit: '%' },
        { name: '5xxErrorRate', target: 0.01, current: 0, unit: '%' },
        { name: 'Uptime', target: 99.99, current: 0, unit: '%' },
      ],
    }),
  }

  // ==========================================================================
  // API CONFIGURATION
  // ==========================================================================

  /**
   * Get API configuration
   */
  async getAPIConfig(): Promise<APIConfig | null> {
    if (!this.apiConfig) {
      this.apiConfig = (await this.ctx.storage.get('api_config')) as APIConfig | null
    }
    return this.apiConfig
  }

  /**
   * Configure the API
   */
  async configureAPI(config: APIConfig): Promise<void> {
    this.apiConfig = config
    await this.ctx.storage.put('api_config', config)
    await this.setConfig(config)
    await this.emit('api.configured', { config })
  }

  /**
   * Add a route
   */
  async addRoute(route: Route): Promise<void> {
    const config = await this.getAPIConfig()
    if (!config) {
      throw new Error('API not configured')
    }
    config.routes.push(route)
    await this.ctx.storage.put('api_config', config)
    await this.emit('route.added', { route })
  }

  // ==========================================================================
  // ROUTING
  // ==========================================================================

  /**
   * Match a route to a request
   */
  protected matchRoute(method: string, path: string): { route: Route; params: Record<string, string> } | null {
    if (!this.apiConfig) return null

    for (const route of this.apiConfig.routes) {
      if (route.method !== method) continue

      // Simple path matching with :params
      const routeParts = route.path.split('/')
      const pathParts = path.split('/')

      if (routeParts.length !== pathParts.length) continue

      const params: Record<string, string> = {}
      let match = true

      for (let i = 0; i < routeParts.length; i++) {
        if (routeParts[i]?.startsWith(':')) {
          params[routeParts[i]!.slice(1)] = pathParts[i]!
        } else if (routeParts[i] !== pathParts[i]) {
          match = false
          break
        }
      }

      if (match) {
        return { route, params }
      }
    }

    return null
  }

  // ==========================================================================
  // RATE LIMITING
  // ==========================================================================

  /**
   * Check rate limit for a client
   */
  async checkRateLimit(clientId: string): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const config = await this.getAPIConfig()
    if (!config?.rateLimit) {
      return { allowed: true, remaining: Infinity, resetAt: 0 }
    }

    const key = `ratelimit:${clientId}`
    const now = Date.now()
    let state = (await this.ctx.storage.get(key)) as RateLimitState | undefined

    if (!state || state.resetAt < now) {
      state = {
        count: 0,
        resetAt: now + config.rateLimit.window * 1000,
      }
    }

    const allowed = state.count < config.rateLimit.requests
    const remaining = Math.max(0, config.rateLimit.requests - state.count - 1)

    if (allowed) {
      state.count++
      await this.ctx.storage.put(key, state)
    }

    return { allowed, remaining, resetAt: state.resetAt }
  }

  // ==========================================================================
  // AUTHENTICATION
  // ==========================================================================

  /**
   * Validate authentication
   */
  async validateAuth(request: Request): Promise<{ valid: boolean; clientId?: string; error?: string }> {
    const config = await this.getAPIConfig()
    if (!config?.authentication) {
      return { valid: true }
    }

    const auth = config.authentication

    switch (auth.type) {
      case 'apiKey': {
        const headerName = auth.headerName || 'X-API-Key'
        const apiKey = request.headers.get(headerName)
        if (!apiKey) {
          return { valid: false, error: `Missing ${headerName} header` }
        }
        // In production, validate against stored API keys
        return { valid: true, clientId: apiKey.slice(0, 8) }
      }

      case 'bearer': {
        const authHeader = request.headers.get('Authorization')
        if (!authHeader?.startsWith('Bearer ')) {
          return { valid: false, error: 'Missing or invalid Authorization header' }
        }
        const token = authHeader.slice(7)
        // In production, validate JWT or session token
        return { valid: true, clientId: token.slice(0, 8) }
      }

      case 'basic': {
        const authHeader = request.headers.get('Authorization')
        if (!authHeader?.startsWith('Basic ')) {
          return { valid: false, error: 'Missing or invalid Authorization header' }
        }
        // In production, decode and validate credentials
        return { valid: true, clientId: 'basic-user' }
      }

      default:
        return { valid: true }
    }
  }

  // ==========================================================================
  // CORS
  // ==========================================================================

  /**
   * Add CORS headers to response
   */
  addCorsHeaders(response: Response): Response {
    const config = this.apiConfig
    if (!config?.cors) return response

    const headers = new Headers(response.headers)
    headers.set('Access-Control-Allow-Origin', config.cors.origins.join(', '))
    headers.set('Access-Control-Allow-Methods', config.cors.methods.join(', '))
    headers.set('Access-Control-Allow-Headers', config.cors.headers.join(', '))

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }

  // ==========================================================================
  // REQUEST HANDLING
  // ==========================================================================

  /**
   * Execute a handler (stub - override in subclasses)
   */
  protected async executeHandler(handler: string, context: RequestContext): Promise<unknown> {
    // Override in subclasses to implement actual handler execution
    return { handler, context }
  }

  /**
   * Handle an API request
   */
  async handleAPIRequest(request: Request): Promise<Response> {
    const config = await this.getAPIConfig()
    if (!config) {
      return new Response('API not configured', { status: 503 })
    }

    const url = new URL(request.url)
    const match = this.matchRoute(request.method, url.pathname)

    if (!match) {
      return new Response('Not Found', { status: 404 })
    }

    const query: Record<string, string> = {}
    url.searchParams.forEach((value, key) => {
      query[key] = value
    })

    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headers[key] = value
    })

    const context: RequestContext = {
      method: request.method,
      path: url.pathname,
      params: match.params,
      query,
      headers,
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      try {
        context.body = await request.json()
      } catch {
        // Body not JSON
      }
    }

    await this.emit('request.received', { handler: match.route.handler, context })

    try {
      const result = await this.executeHandler(match.route.handler, context)
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.emit('request.failed', { handler: match.route.handler, error: message })
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  // ==========================================================================
  // OPENAPI
  // ==========================================================================

  /**
   * Generate OpenAPI spec (stub)
   */
  async getOpenAPISpec(): Promise<Record<string, unknown>> {
    const config = await this.getAPIConfig()
    if (!config) {
      return { openapi: '3.0.0', info: { title: 'API', version: '1.0.0' }, paths: {} }
    }

    const paths: Record<string, unknown> = {}
    for (const route of config.routes) {
      const pathKey = route.path.replace(/:(\w+)/g, '{$1}')
      if (!paths[pathKey]) paths[pathKey] = {}
      ;(paths[pathKey] as Record<string, unknown>)[route.method.toLowerCase()] = {
        operationId: route.handler,
        responses: { '200': { description: 'Success' } },
      }
    }

    return {
      openapi: '3.0.0',
      info: {
        title: config.name,
        version: config.version,
        description: config.description,
      },
      servers: [{ url: config.basePath }],
      paths,
    }
  }

  // ==========================================================================
  // HTTP ENDPOINTS
  // ==========================================================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      const config = await this.getAPIConfig()
      if (config?.cors) {
        return this.addCorsHeaders(new Response(null, { status: 204 }))
      }
    }

    // API management endpoints
    if (url.pathname === '/_config') {
      if (request.method === 'GET') {
        const config = await this.getAPIConfig()
        return new Response(JSON.stringify(config), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (request.method === 'PUT') {
        const config = (await request.json()) as APIConfig
        await this.configureAPI(config)
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/_openapi') {
      const spec = await this.getOpenAPISpec()
      return new Response(JSON.stringify(spec), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Validate authentication
    const auth = await this.validateAuth(request)
    if (!auth.valid) {
      return this.addCorsHeaders(
        new Response(JSON.stringify({ error: auth.error }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }

    // Check rate limit
    if (auth.clientId) {
      const rateLimit = await this.checkRateLimit(auth.clientId)
      if (!rateLimit.allowed) {
        return this.addCorsHeaders(
          new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': String(rateLimit.resetAt),
            },
          }),
        )
      }
    }

    // Handle API request
    const response = await this.handleAPIRequest(request)
    return this.addCorsHeaders(response)
  }
}

export default API
