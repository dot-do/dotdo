/**
 * API - REST/GraphQL API endpoint
 *
 * HTTP API with routing, rate limiting, authentication, CORS.
 * Examples: 'api.acme.com/v1', 'graphql.acme.com'
 */

import { DO, Env } from './DO'

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  path: string
  handler: string
  middleware?: string[]
}

export interface APIConfig {
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

export class API extends DO {
  private config: APIConfig | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * Get API configuration
   */
  async getConfig(): Promise<APIConfig | null> {
    if (!this.config) {
      this.config = (await this.ctx.storage.get('config')) as APIConfig | null
    }
    return this.config
  }

  /**
   * Configure the API
   */
  async configure(config: APIConfig): Promise<void> {
    this.config = config
    await this.ctx.storage.put('config', config)
    await this.emit('api.configured', { config })
  }

  /**
   * Add a route
   */
  async addRoute(route: Route): Promise<void> {
    const config = await this.getConfig()
    if (!config) {
      throw new Error('API not configured')
    }
    config.routes.push(route)
    await this.ctx.storage.put('config', config)
    await this.emit('route.added', { route })
  }

  /**
   * Match a route to a request
   */
  protected matchRoute(method: string, path: string): { route: Route; params: Record<string, string> } | null {
    if (!this.config) return null

    for (const route of this.config.routes) {
      if (route.method !== method) continue

      // Simple path matching with :params
      const routeParts = route.path.split('/')
      const pathParts = path.split('/')

      if (routeParts.length !== pathParts.length) continue

      const params: Record<string, string> = {}
      let match = true

      for (let i = 0; i < routeParts.length; i++) {
        if (routeParts[i].startsWith(':')) {
          params[routeParts[i].slice(1)] = pathParts[i]
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

  /**
   * Check rate limit for a client
   */
  async checkRateLimit(clientId: string): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const config = await this.getConfig()
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

  /**
   * Validate authentication
   */
  async validateAuth(request: Request): Promise<{ valid: boolean; clientId?: string; error?: string }> {
    const config = await this.getConfig()
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

  /**
   * Add CORS headers to response
   */
  addCorsHeaders(response: Response): Response {
    const config = this.config
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
  async handleRequest(request: Request): Promise<Response> {
    const config = await this.getConfig()
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

  /**
   * Generate OpenAPI spec (stub)
   */
  async getOpenAPISpec(): Promise<Record<string, unknown>> {
    const config = await this.getConfig()
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

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      const config = await this.getConfig()
      if (config?.cors) {
        return this.addCorsHeaders(new Response(null, { status: 204 }))
      }
    }

    // API management endpoints
    if (url.pathname === '/_config') {
      if (request.method === 'GET') {
        const config = await this.getConfig()
        return new Response(JSON.stringify(config), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (request.method === 'PUT') {
        const config = (await request.json()) as APIConfig
        await this.configure(config)
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
    const response = await this.handleRequest(request)
    return this.addCorsHeaders(response)
  }
}

export default API
