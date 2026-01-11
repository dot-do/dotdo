/**
 * API Gateway Federation Example
 *
 * Demonstrates federated API gateway patterns across multiple Durable Objects:
 * - Route-based DO dispatching
 * - Request aggregation from multiple DOs
 * - Rate limiting per tenant
 * - Authentication/authorization middleware
 * - Response caching
 * - Circuit breakers for downstream DOs
 * - API versioning
 * - GraphQL federation patterns
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { DurableObject } from 'cloudflare:workers'

// ============================================================================
// TYPES
// ============================================================================

interface Env {
  GATEWAY_DO: DurableObjectNamespace
  USER_DO: DurableObjectNamespace
  ORDER_DO: DurableObjectNamespace
  PRODUCT_DO: DurableObjectNamespace
  RATE_LIMIT_DEFAULT_RPM?: string
  CIRCUIT_BREAKER_THRESHOLD?: string
  ENVIRONMENT?: string
}

interface RateLimitTier {
  rpm: number
  burst: number
}

interface CircuitState {
  failures: number
  state: 'closed' | 'open' | 'half-open'
  lastFailure: number
  halfOpenAttempts: number
}

interface AggregateCall {
  service: string
  method: string
  args?: unknown[]
}

interface CacheEntry {
  value: unknown
  expiresAt: number
}

// ============================================================================
// RATE LIMIT TIERS
// ============================================================================

const RATE_LIMIT_TIERS: Record<string, RateLimitTier> = {
  free: { rpm: 100, burst: 10 },
  starter: { rpm: 1000, burst: 50 },
  pro: { rpm: 10000, burst: 200 },
  enterprise: { rpm: 100000, burst: 1000 },
}

// ============================================================================
// CIRCUIT BREAKER CONFIG
// ============================================================================

const CIRCUIT_BREAKER_CONFIG = {
  threshold: 5, // failures before opening
  timeout: 30_000, // ms to wait before half-open
  halfOpenMax: 3, // test requests in half-open state
}

// ============================================================================
// SERVICE DO CLASSES
// ============================================================================

/**
 * User Service DO - handles user data
 */
export class UserServiceDO extends DurableObject<Env> {
  private users: Map<string, { id: string; name: string; email: string; tier: string }> = new Map([
    ['alice', { id: 'alice', name: 'Alice Johnson', email: 'alice@example.com', tier: 'pro' }],
    ['bob', { id: 'bob', name: 'Bob Smith', email: 'bob@example.com', tier: 'enterprise' }],
    ['charlie', { id: 'charlie', name: 'Charlie Brown', email: 'charlie@example.com', tier: 'free' }],
  ])

  get(id: string) {
    return this.users.get(id) || null
  }

  list() {
    return Array.from(this.users.values())
  }

  create(data: { id: string; name: string; email: string; tier?: string }) {
    const user = { ...data, tier: data.tier || 'free' }
    this.users.set(data.id, user)
    return user
  }

  async fetch(request: Request): Promise<Response> {
    return this.handleRPC(request)
  }

  private async handleRPC(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 })
    }

    try {
      const { method, args = [] } = (await request.json()) as { method: string; args?: unknown[] }
      const fn = this[method as keyof this]
      if (typeof fn !== 'function') {
        return Response.json({ error: `Unknown method: ${method}` }, { status: 400 })
      }
      const result = (fn as (...args: unknown[]) => unknown).apply(this, args)
      return Response.json({ result })
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500 })
    }
  }
}

/**
 * Order Service DO - handles order data
 */
export class OrderServiceDO extends DurableObject<Env> {
  private orders: Map<string, { id: string; userId: string; items: string[]; total: number; status: string }> =
    new Map([
      ['ord-1', { id: 'ord-1', userId: 'alice', items: ['WIDGET-001'], total: 99, status: 'shipped' }],
      ['ord-2', { id: 'ord-2', userId: 'alice', items: ['GADGET-002', 'WIDGET-001'], total: 199, status: 'delivered' }],
      ['ord-3', { id: 'ord-3', userId: 'bob', items: ['ENTERPRISE-001'], total: 1299, status: 'pending' }],
    ])

  get(id: string) {
    return this.orders.get(id) || null
  }

  list(filter?: { userId?: string; status?: string }) {
    let results = Array.from(this.orders.values())
    if (filter?.userId) {
      results = results.filter((o) => o.userId === filter.userId)
    }
    if (filter?.status) {
      results = results.filter((o) => o.status === filter.status)
    }
    return results
  }

  recent(limit: number = 5) {
    return Array.from(this.orders.values()).slice(-limit)
  }

  create(data: { id: string; userId: string; items: string[]; total: number }) {
    const order = { ...data, status: 'pending' }
    this.orders.set(data.id, order)
    return order
  }

  async fetch(request: Request): Promise<Response> {
    return this.handleRPC(request)
  }

  private async handleRPC(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 })
    }

    try {
      const { method, args = [] } = (await request.json()) as { method: string; args?: unknown[] }
      const fn = this[method as keyof this]
      if (typeof fn !== 'function') {
        return Response.json({ error: `Unknown method: ${method}` }, { status: 400 })
      }
      const result = (fn as (...args: unknown[]) => unknown).apply(this, args)
      return Response.json({ result })
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500 })
    }
  }
}

/**
 * Product Service DO - handles product catalog
 */
export class ProductServiceDO extends DurableObject<Env> {
  private products: Map<string, { sku: string; name: string; price: number; stock: number }> = new Map([
    ['WIDGET-001', { sku: 'WIDGET-001', name: 'Premium Widget', price: 99, stock: 150 }],
    ['GADGET-002', { sku: 'GADGET-002', name: 'Smart Gadget', price: 100, stock: 75 }],
    ['ENTERPRISE-001', { sku: 'ENTERPRISE-001', name: 'Enterprise Suite', price: 1299, stock: 10 }],
  ])

  get(sku: string) {
    return this.products.get(sku) || null
  }

  list() {
    return Array.from(this.products.values())
  }

  check(sku: string) {
    const product = this.products.get(sku)
    if (!product) return null
    return { sku, stock: product.stock, available: product.stock > 0 }
  }

  search(query: string) {
    const lowerQuery = query.toLowerCase()
    return Array.from(this.products.values()).filter(
      (p) => p.name.toLowerCase().includes(lowerQuery) || p.sku.toLowerCase().includes(lowerQuery)
    )
  }

  async fetch(request: Request): Promise<Response> {
    return this.handleRPC(request)
  }

  private async handleRPC(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 })
    }

    try {
      const { method, args = [] } = (await request.json()) as { method: string; args?: unknown[] }
      const fn = this[method as keyof this]
      if (typeof fn !== 'function') {
        return Response.json({ error: `Unknown method: ${method}` }, { status: 400 })
      }
      const result = (fn as (...args: unknown[]) => unknown).apply(this, args)
      return Response.json({ result })
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500 })
    }
  }
}

// ============================================================================
// GATEWAY DO - Main Federation Gateway
// ============================================================================

/**
 * GatewayDO - Federated API Gateway
 *
 * Coordinates requests across multiple service DOs with:
 * - Rate limiting per tenant
 * - Circuit breakers per service
 * - Response caching
 * - Request aggregation
 */
export class GatewayDO extends DurableObject<Env> {
  private rateLimits: Map<string, { count: number; windowStart: number }> = new Map()
  private circuitStates: Map<string, CircuitState> = new Map()
  private cache: Map<string, CacheEntry> = new Map()
  private app: Hono<{ Bindings: Env }>

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.app = this.createApp()
  }

  private createApp(): Hono<{ Bindings: Env }> {
    const app = new Hono<{ Bindings: Env }>()

    // CORS middleware
    app.use('*', cors({ origin: '*' }))

    // Rate limiting middleware
    app.use('/api/*', async (c, next) => {
      const tenant = c.req.header('X-Tenant-ID') || 'anonymous'
      const tier = c.req.header('X-Tier') || 'free'

      const allowed = this.checkRateLimit(tenant, tier)
      if (!allowed) {
        return c.json(
          {
            error: 'Rate limit exceeded',
            retryAfter: 60,
          },
          429
        )
      }

      await next()
    })

    // Auth middleware (simplified for demo)
    app.use('/api/*', async (c, next) => {
      const authHeader = c.req.header('Authorization')
      const apiKey = c.req.header('X-API-Key')

      // In production, validate JWT or API key
      // For demo, we just check if something is provided
      if (!authHeader && !apiKey) {
        // Allow anonymous access with free tier limits
        c.set('authenticated' as never, false)
      } else {
        c.set('authenticated' as never, true)
      }

      await next()
    })

    // ========================================================================
    // API v1 Routes - Route to service DOs
    // ========================================================================

    // Users
    app.get('/api/v1/users', async (c) => {
      return this.routeToService(c, 'users', 'list', [])
    })

    app.get('/api/v1/users/:id', async (c) => {
      const id = c.req.param('id')
      return this.routeToService(c, 'users', 'get', [id])
    })

    app.post('/api/v1/users', async (c) => {
      const body = await c.req.json()
      return this.routeToService(c, 'users', 'create', [body])
    })

    // Orders
    app.get('/api/v1/orders', async (c) => {
      const userId = c.req.query('userId')
      const status = c.req.query('status')
      const filter = { userId, status }
      return this.routeToService(c, 'orders', 'list', [filter])
    })

    app.get('/api/v1/orders/:id', async (c) => {
      const id = c.req.param('id')
      return this.routeToService(c, 'orders', 'get', [id])
    })

    app.get('/api/v1/orders/recent/:limit', async (c) => {
      const limit = parseInt(c.req.param('limit') || '5', 10)
      return this.routeToService(c, 'orders', 'recent', [limit])
    })

    // Products
    app.get('/api/v1/products', async (c) => {
      return this.routeToService(c, 'products', 'list', [])
    })

    app.get('/api/v1/products/:sku', async (c) => {
      const sku = c.req.param('sku')
      return this.routeToService(c, 'products', 'get', [sku])
    })

    app.get('/api/v1/products/search/:query', async (c) => {
      const query = c.req.param('query')
      return this.routeToService(c, 'products', 'search', [query])
    })

    app.get('/api/v1/inventory/:sku', async (c) => {
      const sku = c.req.param('sku')
      return this.routeToService(c, 'products', 'check', [sku])
    })

    // ========================================================================
    // Aggregation Endpoint
    // ========================================================================

    app.post('/api/aggregate', async (c) => {
      const body = (await c.req.json()) as { calls: AggregateCall[] }
      return this.aggregate(c, body.calls)
    })

    // ========================================================================
    // GraphQL Endpoint (simplified federation)
    // ========================================================================

    app.post('/graphql', async (c) => {
      const { query, variables } = (await c.req.json()) as { query: string; variables?: Record<string, unknown> }
      return this.handleGraphQL(c, query, variables)
    })

    // ========================================================================
    // Gateway Status Endpoints
    // ========================================================================

    app.get('/api/rate-limit/status', (c) => {
      const tenant = c.req.header('X-Tenant-ID') || 'anonymous'
      const status = this.getRateLimitStatus(tenant)
      return c.json(status)
    })

    app.get('/api/circuit-breaker/status', (c) => {
      const status: Record<string, CircuitState> = {}
      for (const [service, state] of this.circuitStates) {
        status[service] = state
      }
      return c.json(status)
    })

    app.post('/api/circuit-breaker/reset/:service', (c) => {
      const service = c.req.param('service')
      this.circuitStates.delete(service)
      return c.json({ reset: true, service })
    })

    app.get('/api/cache/stats', (c) => {
      const now = Date.now()
      let valid = 0
      let expired = 0
      for (const entry of this.cache.values()) {
        if (entry.expiresAt > now) valid++
        else expired++
      }
      return c.json({ valid, expired, total: this.cache.size })
    })

    app.post('/api/cache/clear', (c) => {
      const size = this.cache.size
      this.cache.clear()
      return c.json({ cleared: size })
    })

    // ========================================================================
    // Health & Info
    // ========================================================================

    app.get('/health', (c) => {
      return c.json({
        status: 'ok',
        service: 'api-gateway-federation',
        circuits: Object.fromEntries(
          Array.from(this.circuitStates.entries()).map(([k, v]) => [k, v.state])
        ),
      })
    })

    app.get('/', (c) => {
      return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>API Gateway Federation</title>
  <style>
    :root { --bg: #0a0a0a; --fg: #fafafa; --accent: #3b82f6; --muted: #71717a; }
    body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--fg); margin: 0; padding: 2rem; line-height: 1.6; }
    h1 { color: var(--accent); margin-bottom: 0.5rem; }
    .subtitle { color: var(--muted); margin-bottom: 2rem; font-size: 1.25rem; }
    code { background: #1f1f1f; padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.9rem; }
    pre { background: #1f1f1f; padding: 1rem; border-radius: 8px; overflow-x: auto; }
    .endpoints { display: grid; gap: 1rem; margin: 2rem 0; }
    .endpoint { background: #1f1f1f; padding: 1rem; border-radius: 8px; border-left: 3px solid var(--accent); }
    .endpoint h3 { margin: 0 0 0.5rem 0; color: var(--accent); font-family: monospace; }
    .endpoint p { margin: 0; color: var(--muted); }
    a { color: var(--accent); }
    .try-it { display: inline-block; margin-top: 0.5rem; padding: 0.25rem 0.5rem; background: var(--accent); color: white; text-decoration: none; border-radius: 4px; font-size: 0.875rem; }
    .section { margin: 2rem 0; }
    .section h2 { border-bottom: 1px solid #333; padding-bottom: 0.5rem; }
  </style>
</head>
<body>
  <h1>API Gateway Federation</h1>
  <p class="subtitle">One gateway. Infinite services. Zero latency.</p>

  <div class="section">
    <h2>Service Routes</h2>
    <div class="endpoints">
      <div class="endpoint">
        <h3>GET /api/v1/users</h3>
        <p>List all users from UserServiceDO</p>
        <a href="/api/v1/users" class="try-it">Try it</a>
      </div>
      <div class="endpoint">
        <h3>GET /api/v1/users/:id</h3>
        <p>Get user by ID</p>
        <a href="/api/v1/users/alice" class="try-it">Try: /api/v1/users/alice</a>
      </div>
      <div class="endpoint">
        <h3>GET /api/v1/orders</h3>
        <p>List orders from OrderServiceDO</p>
        <a href="/api/v1/orders" class="try-it">Try it</a>
      </div>
      <div class="endpoint">
        <h3>GET /api/v1/orders?userId=alice</h3>
        <p>Filter orders by user</p>
        <a href="/api/v1/orders?userId=alice" class="try-it">Try it</a>
      </div>
      <div class="endpoint">
        <h3>GET /api/v1/products</h3>
        <p>List products from ProductServiceDO</p>
        <a href="/api/v1/products" class="try-it">Try it</a>
      </div>
      <div class="endpoint">
        <h3>GET /api/v1/inventory/:sku</h3>
        <p>Check inventory for a product</p>
        <a href="/api/v1/inventory/WIDGET-001" class="try-it">Try: /api/v1/inventory/WIDGET-001</a>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Federation Features</h2>
    <div class="endpoints">
      <div class="endpoint">
        <h3>POST /api/aggregate</h3>
        <p>Aggregate multiple service calls in one request</p>
      </div>
      <div class="endpoint">
        <h3>POST /graphql</h3>
        <p>GraphQL federation endpoint</p>
      </div>
      <div class="endpoint">
        <h3>GET /api/rate-limit/status</h3>
        <p>Check rate limit status for tenant</p>
        <a href="/api/rate-limit/status" class="try-it">Try it</a>
      </div>
      <div class="endpoint">
        <h3>GET /api/circuit-breaker/status</h3>
        <p>Check circuit breaker states</p>
        <a href="/api/circuit-breaker/status" class="try-it">Try it</a>
      </div>
      <div class="endpoint">
        <h3>GET /api/cache/stats</h3>
        <p>View response cache statistics</p>
        <a href="/api/cache/stats" class="try-it">Try it</a>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Aggregation Example</h2>
    <pre><code>curl -X POST /api/aggregate \\
  -H "Content-Type: application/json" \\
  -d '{
    "calls": [
      { "service": "users", "method": "get", "args": ["alice"] },
      { "service": "orders", "method": "list", "args": [{ "userId": "alice" }] },
      { "service": "products", "method": "check", "args": ["WIDGET-001"] }
    ]
  }'</code></pre>
  </div>

  <footer style="margin-top: 3rem; color: var(--muted); border-top: 1px solid #333; padding-top: 1rem;">
    <p>Powered by <a href="https://dotdo.dev">dotdo</a> - Build your 1-Person Unicorn</p>
  </footer>
</body>
</html>
      `)
    })

    return app
  }

  // ==========================================================================
  // Rate Limiting
  // ==========================================================================

  private checkRateLimit(tenant: string, tier: string): boolean {
    const limits = RATE_LIMIT_TIERS[tier] || RATE_LIMIT_TIERS.free
    const now = Date.now()
    const windowMs = 60_000 // 1 minute window

    let state = this.rateLimits.get(tenant)

    // Reset window if expired
    if (!state || now - state.windowStart > windowMs) {
      state = { count: 0, windowStart: now }
    }

    // Check limit
    if (state.count >= limits.rpm) {
      return false
    }

    // Increment and save
    state.count++
    this.rateLimits.set(tenant, state)
    return true
  }

  private getRateLimitStatus(tenant: string): {
    tenant: string
    used: number
    limit: number
    remaining: number
    resetAt: number
  } {
    const state = this.rateLimits.get(tenant) || { count: 0, windowStart: Date.now() }
    const tier = 'free' // In production, look up tenant's tier
    const limits = RATE_LIMIT_TIERS[tier]
    const windowMs = 60_000

    return {
      tenant,
      used: state.count,
      limit: limits.rpm,
      remaining: Math.max(0, limits.rpm - state.count),
      resetAt: state.windowStart + windowMs,
    }
  }

  // ==========================================================================
  // Circuit Breaker
  // ==========================================================================

  private getCircuitState(service: string): CircuitState {
    let state = this.circuitStates.get(service)
    if (!state) {
      state = { failures: 0, state: 'closed', lastFailure: 0, halfOpenAttempts: 0 }
      this.circuitStates.set(service, state)
    }

    const now = Date.now()

    // Check if open circuit should become half-open
    if (state.state === 'open' && now - state.lastFailure > CIRCUIT_BREAKER_CONFIG.timeout) {
      state.state = 'half-open'
      state.halfOpenAttempts = 0
    }

    return state
  }

  private recordSuccess(service: string): void {
    const state = this.getCircuitState(service)
    if (state.state === 'half-open') {
      state.halfOpenAttempts++
      if (state.halfOpenAttempts >= CIRCUIT_BREAKER_CONFIG.halfOpenMax) {
        // Circuit recovered
        state.state = 'closed'
        state.failures = 0
        state.halfOpenAttempts = 0
      }
    } else if (state.state === 'closed') {
      // Reset failure count on success
      state.failures = Math.max(0, state.failures - 1)
    }
  }

  private recordFailure(service: string): void {
    const state = this.getCircuitState(service)
    state.failures++
    state.lastFailure = Date.now()

    if (state.state === 'half-open') {
      // Failed during half-open, go back to open
      state.state = 'open'
    } else if (state.failures >= CIRCUIT_BREAKER_CONFIG.threshold) {
      // Threshold exceeded, open circuit
      state.state = 'open'
    }
  }

  private isCircuitOpen(service: string): boolean {
    const state = this.getCircuitState(service)
    return state.state === 'open'
  }

  // ==========================================================================
  // Response Caching
  // ==========================================================================

  private getCached(key: string): unknown | null {
    const entry = this.cache.get(key)
    if (!entry) return null
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(key)
      return null
    }
    return entry.value
  }

  private setCache(key: string, value: unknown, ttlMs: number = 30_000): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    })
  }

  // ==========================================================================
  // Service Routing
  // ==========================================================================

  private getServiceBinding(service: string): DurableObjectNamespace | null {
    const bindings: Record<string, DurableObjectNamespace> = {
      users: this.env.USER_DO,
      orders: this.env.ORDER_DO,
      products: this.env.PRODUCT_DO,
    }
    return bindings[service] || null
  }

  private async callService(service: string, method: string, args: unknown[]): Promise<unknown> {
    // Check circuit breaker
    if (this.isCircuitOpen(service)) {
      throw new Error(`Circuit breaker open for service: ${service}`)
    }

    // Check cache for GET-style methods
    const cacheKey = `${service}:${method}:${JSON.stringify(args)}`
    const cached = this.getCached(cacheKey)
    if (cached !== null) {
      return cached
    }

    const binding = this.getServiceBinding(service)
    if (!binding) {
      throw new Error(`Unknown service: ${service}`)
    }

    try {
      const id = binding.idFromName('main')
      const stub = binding.get(id)

      const response = await stub.fetch('https://internal/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, args }),
      })

      if (!response.ok) {
        const error = await response.json() as { error: string }
        throw new Error(error.error || 'Service error')
      }

      const { result } = (await response.json()) as { result: unknown }

      // Record success and cache result
      this.recordSuccess(service)
      this.setCache(cacheKey, result)

      return result
    } catch (e) {
      this.recordFailure(service)
      throw e
    }
  }

  private async routeToService(
    c: { env: Env; json: (data: unknown, status?: number) => Response },
    service: string,
    method: string,
    args: unknown[]
  ): Promise<Response> {
    try {
      const result = await this.callService(service, method, args)
      return c.json(result)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      const isCircuitOpen = message.includes('Circuit breaker open')
      return c.json({ error: message }, isCircuitOpen ? 503 : 500)
    }
  }

  // ==========================================================================
  // Request Aggregation
  // ==========================================================================

  private async aggregate(
    c: { env: Env; json: (data: unknown, status?: number) => Response },
    calls: AggregateCall[]
  ): Promise<Response> {
    const results: Record<string, unknown> = {}
    const errors: Record<string, string> = {}

    // Execute all calls in parallel
    await Promise.all(
      calls.map(async (call) => {
        try {
          results[call.service] = await this.callService(call.service, call.method, call.args || [])
        } catch (e) {
          errors[call.service] = e instanceof Error ? e.message : String(e)
        }
      })
    )

    return c.json({
      results,
      errors: Object.keys(errors).length > 0 ? errors : undefined,
    })
  }

  // ==========================================================================
  // GraphQL Federation (Simplified)
  // ==========================================================================

  private async handleGraphQL(
    c: { env: Env; json: (data: unknown, status?: number) => Response },
    query: string,
    variables?: Record<string, unknown>
  ): Promise<Response> {
    // Simplified GraphQL resolver - in production use a proper GraphQL library
    // This demonstrates the federation pattern concept

    try {
      // Parse simple queries like: { user(id: "alice") { name orders { total } } }
      const userMatch = query.match(/user\s*\(\s*id:\s*"([^"]+)"\s*\)/)

      if (userMatch) {
        const userId = variables?.id as string || userMatch[1]
        const user = await this.callService('users', 'get', [userId])

        if (!user) {
          return c.json({ data: { user: null } })
        }

        // Check if orders are requested
        if (query.includes('orders')) {
          const orders = await this.callService('orders', 'list', [{ userId }])
          return c.json({
            data: {
              user: { ...(user as object), orders },
            },
          })
        }

        return c.json({ data: { user } })
      }

      // Parse: { users { id name } }
      if (query.includes('users')) {
        const users = await this.callService('users', 'list', [])
        return c.json({ data: { users } })
      }

      // Parse: { products { sku name price } }
      if (query.includes('products')) {
        const products = await this.callService('products', 'list', [])
        return c.json({ data: { products } })
      }

      // Parse: { orders { id total status } }
      if (query.includes('orders')) {
        const orders = await this.callService('orders', 'list', [{}])
        return c.json({ data: { orders } })
      }

      return c.json({
        errors: [{ message: 'Query not supported in this demo. Try: { users { id name } }' }],
      })
    } catch (e) {
      return c.json({
        errors: [{ message: e instanceof Error ? e.message : String(e) }],
      })
    }
  }

  // ==========================================================================
  // HTTP Handler
  // ==========================================================================

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request, this.env)
  }
}

// ============================================================================
// WORKER ENTRY POINT
// ============================================================================

const app = new Hono<{ Bindings: Env }>()

// Enable CORS
app.use('*', cors({ origin: '*' }))

// Route all requests to the GatewayDO
app.all('*', async (c) => {
  const id = c.env.GATEWAY_DO.idFromName('main')
  const stub = c.env.GATEWAY_DO.get(id)
  return stub.fetch(c.req.raw)
})

export default app
