/**
 * Service - Long-running service with multiple endpoints
 *
 * Represents a microservice with routing, middleware, and state.
 * Combines multiple Functions into a cohesive API.
 */

import { DO, Env } from './DO'

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  path: string
  handler: string
  middleware?: string[]
}

export interface ServiceConfig {
  name: string
  description?: string
  routes: Route[]
  middleware?: string[]
}

export interface RequestContext {
  method: string
  path: string
  params: Record<string, string>
  query: Record<string, string>
  headers: Record<string, string>
  body?: unknown
}

export class Service extends DO {
  private config: ServiceConfig | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * Get service configuration
   */
  async getConfig(): Promise<ServiceConfig | null> {
    if (!this.config) {
      this.config = await this.ctx.storage.get('config') as ServiceConfig | null
    }
    return this.config
  }

  /**
   * Configure the service
   */
  async configure(config: ServiceConfig): Promise<void> {
    this.config = config
    await this.ctx.storage.put('config', config)
    await this.emit('service.configured', { config })
  }

  /**
   * Add a route
   */
  async addRoute(route: Route): Promise<void> {
    const config = await this.getConfig()
    if (!config) {
      throw new Error('Service not configured')
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
   * Handle incoming request
   */
  async handleRequest(request: Request): Promise<Response> {
    const config = await this.getConfig()
    if (!config) {
      return new Response('Service not configured', { status: 503 })
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
   * Execute a handler (stub - override in subclasses)
   */
  protected async executeHandler(handler: string, context: RequestContext): Promise<unknown> {
    // Override in subclasses to implement actual handler execution
    return { handler, context }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/_config') {
      if (request.method === 'GET') {
        const config = await this.getConfig()
        return new Response(JSON.stringify(config), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (request.method === 'PUT') {
        const config = await request.json() as ServiceConfig
        await this.configure(config)
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // Default: route the request
    return this.handleRequest(request)
  }
}

export default Service
