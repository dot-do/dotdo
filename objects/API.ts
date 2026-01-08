/**
 * API - REST/GraphQL API endpoint
 *
 * Extends Service with API-specific features: versioning, rate limiting, docs.
 * Examples: 'api.acme.com/v1', 'graphql.acme.com'
 */

import { Service, ServiceConfig, Route, RequestContext } from './Service'
import { Env } from './DO'

export interface APIConfig extends ServiceConfig {
  version: string
  basePath: string
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

export interface RateLimitState {
  count: number
  resetAt: number
}

export class API extends Service {
  private apiConfig: APIConfig | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * Get API configuration
   */
  async getAPIConfig(): Promise<APIConfig | null> {
    if (!this.apiConfig) {
      this.apiConfig = await this.ctx.storage.get('api_config') as APIConfig | null
    }
    return this.apiConfig
  }

  /**
   * Configure the API
   */
  async configureAPI(config: APIConfig): Promise<void> {
    this.apiConfig = config
    await this.ctx.storage.put('api_config', config)
    await this.configure(config)
    await this.emit('api.configured', { config })
  }

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
    let state = await this.ctx.storage.get(key) as RateLimitState | undefined

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

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      const config = await this.getAPIConfig()
      if (config?.cors) {
        return this.addCorsHeaders(new Response(null, { status: 204 }))
      }
    }

    // API-specific endpoints
    if (url.pathname === '/_api/config') {
      if (request.method === 'GET') {
        const config = await this.getAPIConfig()
        return new Response(JSON.stringify(config), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (request.method === 'PUT') {
        const config = await request.json() as APIConfig
        await this.configureAPI(config)
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/_api/openapi') {
      const spec = await this.getOpenAPISpec()
      return new Response(JSON.stringify(spec), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Validate authentication
    const auth = await this.validateAuth(request)
    if (!auth.valid) {
      return this.addCorsHeaders(new Response(JSON.stringify({ error: auth.error }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }))
    }

    // Check rate limit
    if (auth.clientId) {
      const rateLimit = await this.checkRateLimit(auth.clientId)
      if (!rateLimit.allowed) {
        return this.addCorsHeaders(new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(rateLimit.resetAt),
          },
        }))
      }
    }

    // Handle request via Service
    const response = await super.fetch(request)
    return this.addCorsHeaders(response)
  }
}

export default API
