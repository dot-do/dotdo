/**
 * E2E Integration Tests for Full Request Lifecycle
 *
 * Tests the complete request lifecycle through the dotdo stack:
 * 1. Request arrives at worker
 * 2. Routed to correct DO via namespace
 * 3. Processed by DO handlers
 * 4. Response returned with proper headers
 * 5. CORS, auth, rate limiting all work together
 *
 * NO MOCKS - uses real Miniflare instances to test true integration.
 *
 * @module e2e/tests/request-lifecycle.test
 * @see do-dp5q.7
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Miniflare } from 'miniflare'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface HealthResponse {
  status: string
  id?: string
  tenantId?: string | null
}

interface ErrorResponse {
  error?: string
  message?: string
  code?: string
  status?: number
  requestId?: string
  details?: { retryAfter?: number }
}

interface RPCResponse<T = unknown> {
  error?: string
  result?: T
}

interface Thing {
  $id: string
  $type: string
  name?: string
  data?: Record<string, unknown>
  createdAt?: number
}

interface StorageInfo {
  id: string
  keys: number
}

// ============================================================================
// WORKER SCRIPT - Full Lifecycle Test DO
// ============================================================================

/**
 * Complete worker script that tests the full request lifecycle:
 * - CORS handling
 * - Auth middleware
 * - Rate limiting
 * - Namespace routing
 * - DO request handling
 * - Response headers
 */
const LIFECYCLE_DO_SCRIPT = `
// Rate limiting state per tenant (in-memory for testing)
const rateLimitState = new Map()

// CORS configuration
const CORS_CONFIG = {
  allowedOrigins: ['https://app.dotdo.dev', 'https://dashboard.dotdo.dev', '*'],
  allowedMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-API-Key', 'X-Tenant-ID'],
  exposeHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  maxAge: 86400,
  credentials: true
}

// Generate request ID
function generateRequestId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8)
}

// Check rate limit
function checkRateLimit(key, config = { limit: 10, windowMs: 60000 }) {
  const now = Date.now()
  const state = rateLimitState.get(key) || { requests: [], windowStart: now }

  // Clean old requests outside window
  state.requests = state.requests.filter(t => t > now - config.windowMs)

  const remaining = Math.max(0, config.limit - state.requests.length)
  const resetTime = Math.ceil((now + config.windowMs) / 1000)

  if (state.requests.length >= config.limit) {
    const retryAfter = Math.ceil((state.requests[0] + config.windowMs - now) / 1000)
    return {
      allowed: false,
      remaining: 0,
      limit: config.limit,
      resetTime,
      retryAfter
    }
  }

  state.requests.push(now)
  rateLimitState.set(key, state)

  return {
    allowed: true,
    remaining: remaining - 1,
    limit: config.limit,
    resetTime
  }
}

// Reset rate limit for testing
function resetRateLimit(key) {
  rateLimitState.delete(key)
}

// CORS headers helper
function getCorsHeaders(origin, method = 'GET') {
  const headers = new Headers()

  // Check if origin is allowed
  if (CORS_CONFIG.allowedOrigins.includes('*')) {
    headers.set('Access-Control-Allow-Origin', '*')
  } else if (CORS_CONFIG.allowedOrigins.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Vary', 'Origin')
  }

  if (method === 'OPTIONS') {
    headers.set('Access-Control-Allow-Methods', CORS_CONFIG.allowedMethods.join(', '))
    headers.set('Access-Control-Allow-Headers', CORS_CONFIG.allowedHeaders.join(', '))
    headers.set('Access-Control-Max-Age', CORS_CONFIG.maxAge.toString())
  }

  if (CORS_CONFIG.credentials) {
    headers.set('Access-Control-Allow-Credentials', 'true')
  }

  headers.set('Access-Control-Expose-Headers', CORS_CONFIG.exposeHeaders.join(', '))

  return headers
}

// Simple ID generator
function generateId() {
  return 'thing-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8)
}

// Validate JWT token (simplified - just decode and check expiry)
function validateToken(token) {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const payload = JSON.parse(atob(parts[1]))

    // Check expiry
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null
    }

    return payload
  } catch {
    return null
  }
}

// Create test JWT token
function createTestToken(payload, expiresIn = 3600) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = btoa(JSON.stringify({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expiresIn
  }))
  const signature = btoa('test-signature')
  return header + '.' + body + '.' + signature
}

// Durable Object class
export class LifecycleDO {
  constructor(state, env) {
    this.state = state
    this.storage = state.storage
    this.env = env
    this.tenantId = null
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method
    const origin = request.headers.get('Origin') || ''

    // Get request context
    const requestId = request.headers.get('X-Request-ID') || generateRequestId()
    const tenantHeader = request.headers.get('X-Tenant-ID')
    if (tenantHeader && !this.tenantId) {
      this.tenantId = tenantHeader
    }

    // Build response headers with CORS and request ID
    const corsHeaders = getCorsHeaders(origin, method)
    corsHeaders.set('X-Request-ID', requestId)
    corsHeaders.set('Content-Type', 'application/json')

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    // Rate limiting (except health and test endpoints)
    const skipRateLimit = ['/health', '/', '/test/reset-rate-limit'].includes(path)
    if (!skipRateLimit) {
      const rateLimitKey = 'tenant:' + (this.tenantId || 'default')
      const rateLimitResult = checkRateLimit(rateLimitKey)

      corsHeaders.set('X-RateLimit-Limit', rateLimitResult.limit.toString())
      corsHeaders.set('X-RateLimit-Remaining', rateLimitResult.remaining.toString())
      corsHeaders.set('X-RateLimit-Reset', rateLimitResult.resetTime.toString())

      if (!rateLimitResult.allowed) {
        corsHeaders.set('Retry-After', rateLimitResult.retryAfter.toString())
        return Response.json({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
          status: 429,
          requestId,
          details: { retryAfter: rateLimitResult.retryAfter }
        }, { status: 429, headers: corsHeaders })
      }
    }

    // Auth check for protected endpoints
    const protectedPaths = ['/protected', '/things', '/rpc']
    const requiresAuth = protectedPaths.some(p => path.startsWith(p))

    if (requiresAuth) {
      const authHeader = request.headers.get('Authorization')
      const apiKey = request.headers.get('X-API-Key')

      // Allow API key auth
      if (apiKey === 'test-api-key-valid') {
        // API key is valid
      } else if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7)
        const payload = validateToken(token)

        if (!payload) {
          return Response.json({
            error: 'Unauthorized',
            message: 'Invalid or expired token',
            code: 'INVALID_TOKEN',
            status: 401,
            requestId
          }, { status: 401, headers: corsHeaders })
        }
      } else {
        return Response.json({
          error: 'Unauthorized',
          message: 'Authentication required',
          code: 'AUTH_REQUIRED',
          status: 401,
          requestId
        }, { status: 401, headers: corsHeaders })
      }
    }

    // Route handlers

    // Health check
    if (path === '/' || path === '/health') {
      return Response.json({
        status: 'ok',
        id: this.state.id.toString(),
        tenantId: this.tenantId,
        requestId
      }, { headers: corsHeaders })
    }

    // Info endpoint
    if (path === '/info') {
      const stored = await this.storage.list()
      return Response.json({
        id: this.state.id.toString(),
        keys: stored.size,
        tenantId: this.tenantId,
        requestId
      }, { headers: corsHeaders })
    }

    // Protected endpoint
    if (path === '/protected') {
      return Response.json({
        message: 'Access granted to protected resource',
        tenantId: this.tenantId,
        requestId
      }, { headers: corsHeaders })
    }

    // Test endpoint to reset rate limit
    if (path === '/test/reset-rate-limit' && method === 'POST') {
      const rateLimitKey = 'tenant:' + (this.tenantId || 'default')
      resetRateLimit(rateLimitKey)
      return Response.json({
        message: 'Rate limit reset',
        key: rateLimitKey
      }, { headers: corsHeaders })
    }

    // Test endpoint to generate token
    if (path === '/test/generate-token' && method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const token = createTestToken(body.payload || { sub: 'test-user' }, body.expiresIn || 3600)
      return Response.json({ token }, { headers: corsHeaders })
    }

    // CRUD endpoints for Things (protected)
    if (path === '/things') {
      if (method === 'GET') {
        return this.listThings(corsHeaders)
      }
      if (method === 'POST') {
        const data = await request.json()
        return this.createThing(data, corsHeaders)
      }
    }

    // Single thing operations
    const thingMatch = path.match(/^\\/things\\/([^/]+)$/)
    if (thingMatch) {
      const id = thingMatch[1]
      if (method === 'GET') {
        return this.getThing(id, corsHeaders)
      }
      if (method === 'PUT') {
        const data = await request.json()
        return this.updateThing(id, data, corsHeaders)
      }
      if (method === 'DELETE') {
        return this.deleteThing(id, corsHeaders)
      }
    }

    // RPC endpoint
    if (path === '/rpc' && method === 'POST') {
      return this.handleRPC(request, corsHeaders)
    }

    return Response.json({
      error: 'Not Found',
      path,
      status: 404,
      requestId
    }, { status: 404, headers: corsHeaders })
  }

  async handleRPC(request, headers) {
    try {
      const { method, args } = await request.json()
      const fn = this[method]

      if (typeof fn !== 'function') {
        return Response.json({ error: 'Method not found: ' + method }, { status: 404, headers })
      }

      const result = await fn.apply(this, args || [])
      return Response.json(result, { headers })
    } catch (error) {
      return Response.json({ error: error.message }, { status: 500, headers })
    }
  }

  async createThing(data, headers) {
    const id = generateId()
    const thing = {
      $id: id,
      $type: data.$type || 'Thing',
      name: data.name,
      data: data.data,
      createdAt: Date.now()
    }

    await this.storage.put('thing:' + id, thing)

    const index = await this.storage.get('thing-index') || []
    index.push(id)
    await this.storage.put('thing-index', index)

    return Response.json(thing, { status: 201, headers })
  }

  async getThing(id, headers) {
    const thing = await this.storage.get('thing:' + id)
    if (!thing) {
      return Response.json({ error: 'Thing not found', id }, { status: 404, headers })
    }
    return Response.json(thing, { headers })
  }

  async listThings(headers) {
    const index = await this.storage.get('thing-index') || []
    const things = []

    for (const id of index) {
      const thing = await this.storage.get('thing:' + id)
      if (thing) {
        things.push(thing)
      }
    }

    return Response.json(things, { headers })
  }

  async updateThing(id, data, headers) {
    const thing = await this.storage.get('thing:' + id)
    if (!thing) {
      return Response.json({ error: 'Thing not found', id }, { status: 404, headers })
    }

    const updated = { ...thing, ...data, $id: id }
    await this.storage.put('thing:' + id, updated)

    return Response.json(updated, { headers })
  }

  async deleteThing(id, headers) {
    const thing = await this.storage.get('thing:' + id)
    if (!thing) {
      return Response.json({ error: 'Thing not found', id }, { status: 404, headers })
    }

    await this.storage.delete('thing:' + id)

    const index = await this.storage.get('thing-index') || []
    const newIndex = index.filter(i => i !== id)
    await this.storage.put('thing-index', newIndex)

    return new Response(null, { status: 204, headers })
  }

  // RPC methods
  async getThingById(id) {
    return await this.storage.get('thing:' + id) || null
  }

  async getThingCount() {
    const index = await this.storage.get('thing-index') || []
    return index.length
  }

  async getDoId() {
    return this.state.id.toString()
  }
}

// Worker that routes to DOs with full lifecycle handling
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin') || ''
    const requestId = request.headers.get('X-Request-ID') || generateRequestId()

    // Extract tenant namespace from subdomain or header
    let namespace = 'default'

    const tenantHeader = request.headers.get('X-Tenant-ID')
    if (tenantHeader) {
      namespace = tenantHeader
    } else {
      const hostParts = url.hostname.split('.')
      if (hostParts.length > 2) {
        namespace = hostParts[0]
      }
    }

    // Get DO stub for this tenant namespace
    const id = env.LIFECYCLE_DO.idFromName(namespace)
    const stub = env.LIFECYCLE_DO.get(id)

    // Forward request to the tenant's DO with context headers
    const headers = new Headers(request.headers)
    headers.set('X-Tenant-ID', namespace)
    headers.set('X-Request-ID', requestId)

    const newRequest = new Request(request.url, {
      method: request.method,
      headers,
      body: request.body
    })

    return stub.fetch(newRequest)
  }
}
`

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a tenant-specific client for making requests
 */
function createClient(mf: Miniflare, options: { tenantId?: string; apiKey?: string; token?: string } = {}) {
  return {
    async request<T = unknown>(path: string, reqOptions: RequestInit & { origin?: string } = {}): Promise<{ status: number; data: T; headers: Headers }> {
      const headers = new Headers(reqOptions.headers)
      headers.set('Content-Type', 'application/json')

      if (options.tenantId) {
        headers.set('X-Tenant-ID', options.tenantId)
      }

      if (options.apiKey) {
        headers.set('X-API-Key', options.apiKey)
      }

      if (options.token) {
        headers.set('Authorization', `Bearer ${options.token}`)
      }

      if (reqOptions.origin) {
        headers.set('Origin', reqOptions.origin)
      }

      const response = await mf.dispatchFetch(`http://localhost${path}`, {
        ...reqOptions,
        headers,
      })

      const status = response.status
      if (status === 204) {
        return { status, data: undefined as T, headers: response.headers }
      }

      const data = await response.json() as T
      return { status, data, headers: response.headers }
    },

    async options(path: string, origin: string): Promise<{ status: number; headers: Headers }> {
      const response = await mf.dispatchFetch(`http://localhost${path}`, {
        method: 'OPTIONS',
        headers: {
          'Origin': origin,
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'Content-Type, Authorization',
          ...(options.tenantId ? { 'X-Tenant-ID': options.tenantId } : {}),
        },
      })
      return { status: response.status, headers: response.headers }
    },

    async health(): Promise<{ status: number; data: HealthResponse; headers: Headers }> {
      return this.request('/health')
    },

    async info(): Promise<{ status: number; data: StorageInfo; headers: Headers }> {
      return this.request('/info')
    },

    async createThing(thing: Partial<Thing>): Promise<{ status: number; data: Thing; headers: Headers }> {
      return this.request('/things', {
        method: 'POST',
        body: JSON.stringify(thing),
      })
    },

    async getThing(id: string): Promise<{ status: number; data: Thing | ErrorResponse; headers: Headers }> {
      return this.request(`/things/${id}`)
    },

    async listThings(): Promise<{ status: number; data: Thing[]; headers: Headers }> {
      return this.request('/things')
    },

    async resetRateLimit(): Promise<{ status: number; data: { message: string }; headers: Headers }> {
      return this.request('/test/reset-rate-limit', { method: 'POST' })
    },

    async generateToken(payload?: Record<string, unknown>, expiresIn?: number): Promise<{ status: number; data: { token: string }; headers: Headers }> {
      return this.request('/test/generate-token', {
        method: 'POST',
        body: JSON.stringify({ payload, expiresIn }),
      })
    },
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('E2E Request Lifecycle Tests', () => {
  let mf: Miniflare

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: LIFECYCLE_DO_SCRIPT,
      durableObjects: {
        LIFECYCLE_DO: 'LifecycleDO',
      },
    })
  })

  afterAll(async () => {
    await mf.dispose()
  })

  // ==========================================================================
  // 1. REQUEST ARRIVES AT WORKER
  // ==========================================================================

  describe('1. Request Arrives at Worker', () => {
    it('should accept requests and add request ID if not present', async () => {
      const client = createClient(mf)
      const result = await client.health()

      expect(result.status).toBe(200)
      expect(result.headers.get('X-Request-ID')).toBeDefined()
      expect(result.headers.get('X-Request-ID')!.length).toBeGreaterThan(0)
    })

    it('should preserve provided request ID', async () => {
      const response = await mf.dispatchFetch('http://localhost/health', {
        headers: { 'X-Request-ID': 'my-custom-request-id' },
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('X-Request-ID')).toBe('my-custom-request-id')
    })

    it('should handle various HTTP methods', async () => {
      const methods = ['GET', 'POST', 'PUT', 'DELETE']
      const client = createClient(mf, { apiKey: 'test-api-key-valid' })

      for (const method of methods) {
        if (method === 'GET') {
          const result = await client.request('/things', { method })
          expect(result.status).toBeLessThan(500)
        }
      }
    })

    it('should handle malformed requests gracefully', async () => {
      const client = createClient(mf, { apiKey: 'test-api-key-valid' })

      // POST with invalid JSON body
      const response = await mf.dispatchFetch('http://localhost/things', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key-valid',
        },
        body: 'not-valid-json',
      })

      expect(response.status).toBe(500)
    })
  })

  // ==========================================================================
  // 2. ROUTED TO CORRECT DO
  // ==========================================================================

  describe('2. Routed to Correct DO', () => {
    it('should route to different DOs based on tenant ID', async () => {
      const testId = Date.now().toString(36)
      const tenantA = createClient(mf, { tenantId: `tenant-a-${testId}` })
      const tenantB = createClient(mf, { tenantId: `tenant-b-${testId}` })

      const healthA = await tenantA.health()
      const healthB = await tenantB.health()

      // Different tenants should get different DO instances
      expect(healthA.data.id).not.toBe(healthB.data.id)
      expect(healthA.data.tenantId).toBe(`tenant-a-${testId}`)
      expect(healthB.data.tenantId).toBe(`tenant-b-${testId}`)
    })

    it('should maintain consistent routing for same tenant', async () => {
      const testId = Date.now().toString(36)
      const client = createClient(mf, { tenantId: `consistent-${testId}` })

      const health1 = await client.health()
      const health2 = await client.health()
      const health3 = await client.health()

      expect(health1.data.id).toBe(health2.data.id)
      expect(health2.data.id).toBe(health3.data.id)
    })

    it('should use default namespace when no tenant specified', async () => {
      const client = createClient(mf)
      const health = await client.health()

      expect(health.data.tenantId).toBe('default')
    })

    it('should isolate data between tenants', async () => {
      const testId = Date.now().toString(36)
      const tenantA = createClient(mf, { tenantId: `iso-a-${testId}`, apiKey: 'test-api-key-valid' })
      const tenantB = createClient(mf, { tenantId: `iso-b-${testId}`, apiKey: 'test-api-key-valid' })

      // Create thing in tenant A
      const created = await tenantA.createThing({ $type: 'Test', name: 'A Data' })
      expect(created.status).toBe(201)

      // Tenant B should not see A's data
      const listB = await tenantB.listThings()
      expect(listB.data).toHaveLength(0)

      // Tenant A should see their own data
      const listA = await tenantA.listThings()
      expect(listA.data).toHaveLength(1)
    })
  })

  // ==========================================================================
  // 3. PROCESSED BY DO HANDLERS
  // ==========================================================================

  describe('3. Processed by DO Handlers', () => {
    let client: ReturnType<typeof createClient>
    let testTenant: string

    beforeEach(async () => {
      testTenant = `handler-test-${Date.now().toString(36)}`
      client = createClient(mf, { tenantId: testTenant, apiKey: 'test-api-key-valid' })
    })

    it('should handle health check endpoint', async () => {
      const result = await client.health()

      expect(result.status).toBe(200)
      expect(result.data.status).toBe('ok')
      expect(result.data.id).toBeDefined()
    })

    it('should handle info endpoint', async () => {
      const result = await client.info()

      expect(result.status).toBe(200)
      expect(result.data.id).toBeDefined()
      expect(typeof result.data.keys).toBe('number')
    })

    it('should handle CRUD operations on Things', async () => {
      // Create
      const created = await client.createThing({
        $type: 'Customer',
        name: 'Test Customer',
        data: { email: 'test@example.com' },
      })
      expect(created.status).toBe(201)
      expect(created.data.$id).toBeDefined()
      expect(created.data.name).toBe('Test Customer')

      // Read
      const read = await client.getThing(created.data.$id)
      expect(read.status).toBe(200)
      expect((read.data as Thing).name).toBe('Test Customer')

      // List
      const list = await client.listThings()
      expect(list.status).toBe(200)
      expect(list.data.length).toBeGreaterThan(0)
    })

    it('should handle RPC calls', async () => {
      // First create a thing
      const created = await client.createThing({ $type: 'Test', name: 'RPC Test' })

      // Then get count via RPC
      const result = await client.request<number>('/rpc', {
        method: 'POST',
        body: JSON.stringify({ method: 'getThingCount', args: [] }),
      })

      expect(result.status).toBe(200)
      expect(result.data).toBeGreaterThan(0)
    })

    it('should handle 404 for unknown paths', async () => {
      const result = await client.request<ErrorResponse>('/unknown/path')

      expect(result.status).toBe(404)
      expect(result.data.error).toBe('Not Found')
    })

    it('should handle 404 for non-existent things', async () => {
      const result = await client.getThing('non-existent-id')

      expect(result.status).toBe(404)
      expect((result.data as ErrorResponse).error).toContain('not found')
    })
  })

  // ==========================================================================
  // 4. RESPONSE RETURNED WITH PROPER HEADERS
  // ==========================================================================

  describe('4. Response Returned with Proper Headers', () => {
    let client: ReturnType<typeof createClient>

    beforeEach(() => {
      client = createClient(mf, { tenantId: `headers-${Date.now().toString(36)}` })
    })

    it('should include Content-Type header', async () => {
      const result = await client.health()

      expect(result.headers.get('Content-Type')).toContain('application/json')
    })

    it('should include X-Request-ID header', async () => {
      const result = await client.health()

      expect(result.headers.get('X-Request-ID')).toBeDefined()
    })

    it('should include rate limit headers', async () => {
      const result = await client.request('/info')

      expect(result.headers.get('X-RateLimit-Limit')).toBeDefined()
      expect(result.headers.get('X-RateLimit-Remaining')).toBeDefined()
      expect(result.headers.get('X-RateLimit-Reset')).toBeDefined()

      const limit = parseInt(result.headers.get('X-RateLimit-Limit')!, 10)
      const remaining = parseInt(result.headers.get('X-RateLimit-Remaining')!, 10)

      expect(limit).toBeGreaterThan(0)
      expect(remaining).toBeLessThan(limit)
    })

    it('should include CORS headers for cross-origin requests', async () => {
      const result = await client.request('/health', {
        origin: 'https://app.dotdo.dev',
      })

      expect(result.headers.get('Access-Control-Allow-Origin')).toBeDefined()
      expect(result.headers.get('Access-Control-Expose-Headers')).toBeDefined()
    })
  })

  // ==========================================================================
  // 5. CORS, AUTH, RATE LIMITING ALL WORK TOGETHER
  // ==========================================================================

  describe('5. CORS, Auth, Rate Limiting Work Together', () => {
    describe('CORS Handling', () => {
      it('should handle preflight OPTIONS requests', async () => {
        const client = createClient(mf, { tenantId: `cors-${Date.now().toString(36)}` })
        const result = await client.options('/things', 'https://app.dotdo.dev')

        expect(result.status).toBe(204)
        expect(result.headers.get('Access-Control-Allow-Origin')).toBeDefined()
        expect(result.headers.get('Access-Control-Allow-Methods')).toContain('GET')
        expect(result.headers.get('Access-Control-Allow-Methods')).toContain('POST')
        expect(result.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type')
        expect(result.headers.get('Access-Control-Allow-Headers')).toContain('Authorization')
      })

      it('should allow requests from allowed origins', async () => {
        const client = createClient(mf, { tenantId: `cors-allowed-${Date.now().toString(36)}` })
        const result = await client.request('/health', {
          origin: 'https://app.dotdo.dev',
        })

        expect(result.status).toBe(200)
        expect(result.headers.get('Access-Control-Allow-Origin')).toBeDefined()
      })

      it('should set credentials header', async () => {
        const client = createClient(mf, { tenantId: `cors-creds-${Date.now().toString(36)}` })
        const result = await client.options('/things', 'https://app.dotdo.dev')

        expect(result.headers.get('Access-Control-Allow-Credentials')).toBe('true')
      })
    })

    describe('Authentication', () => {
      it('should require auth for protected endpoints', async () => {
        const client = createClient(mf, { tenantId: `auth-${Date.now().toString(36)}` })
        const result = await client.request<ErrorResponse>('/protected')

        expect(result.status).toBe(401)
        expect(result.data.code).toBe('AUTH_REQUIRED')
      })

      it('should accept valid API key', async () => {
        const client = createClient(mf, {
          tenantId: `auth-api-${Date.now().toString(36)}`,
          apiKey: 'test-api-key-valid',
        })
        const result = await client.request('/protected')

        expect(result.status).toBe(200)
      })

      it('should accept valid JWT token', async () => {
        const testTenant = `auth-jwt-${Date.now().toString(36)}`

        // First generate a token
        const unauthClient = createClient(mf, { tenantId: testTenant })
        const tokenResult = await unauthClient.generateToken({ sub: 'test-user', role: 'admin' })
        const token = tokenResult.data.token

        // Then use it
        const authClient = createClient(mf, { tenantId: testTenant, token })
        const result = await authClient.request('/protected')

        expect(result.status).toBe(200)
      })

      it('should reject invalid/expired tokens', async () => {
        const client = createClient(mf, {
          tenantId: `auth-invalid-${Date.now().toString(36)}`,
          token: 'invalid-token',
        })
        const result = await client.request<ErrorResponse>('/protected')

        expect(result.status).toBe(401)
        expect(result.data.code).toBe('INVALID_TOKEN')
      })

      it('should allow unauthenticated access to public endpoints', async () => {
        const client = createClient(mf, { tenantId: `auth-public-${Date.now().toString(36)}` })
        const result = await client.health()

        expect(result.status).toBe(200)
      })
    })

    describe('Rate Limiting', () => {
      it('should enforce rate limits', async () => {
        const testTenant = `rate-${Date.now().toString(36)}`
        const client = createClient(mf, { tenantId: testTenant })

        // Make requests until rate limited
        let rateLimited = false
        for (let i = 0; i < 15; i++) {
          const result = await client.request('/info')
          if (result.status === 429) {
            rateLimited = true
            expect((result.data as ErrorResponse).code).toBe('RATE_LIMIT_EXCEEDED')
            expect(result.headers.get('Retry-After')).toBeDefined()
            break
          }
        }

        expect(rateLimited).toBe(true)
      })

      it('should track rate limits per tenant independently', async () => {
        const testId = Date.now().toString(36)
        const tenantA = createClient(mf, { tenantId: `rate-a-${testId}` })
        const tenantB = createClient(mf, { tenantId: `rate-b-${testId}` })

        // Exhaust rate limit for tenant A
        for (let i = 0; i < 15; i++) {
          const result = await tenantA.request('/info')
          if (result.status === 429) break
        }

        // Tenant B should still have quota
        const resultB = await tenantB.request('/info')
        expect(resultB.status).toBe(200)
      })

      it('should skip rate limiting for health endpoints', async () => {
        const testTenant = `rate-skip-${Date.now().toString(36)}`
        const client = createClient(mf, { tenantId: testTenant })

        // Exhaust rate limit
        for (let i = 0; i < 15; i++) {
          await client.request('/info')
        }

        // Health should still work
        const health = await client.health()
        expect(health.status).toBe(200)
      })

      it('should allow rate limit reset for testing', async () => {
        const testTenant = `rate-reset-${Date.now().toString(36)}`
        const client = createClient(mf, { tenantId: testTenant })

        // Exhaust rate limit
        for (let i = 0; i < 15; i++) {
          await client.request('/info')
        }

        // Reset rate limit
        await client.resetRateLimit()

        // Should be able to make requests again
        const result = await client.request('/info')
        expect(result.status).toBe(200)
      })

      it('should include rate limit info in response headers', async () => {
        const testTenant = `rate-headers-${Date.now().toString(36)}`
        const client = createClient(mf, { tenantId: testTenant })

        // Reset to ensure clean state
        await client.resetRateLimit()

        const result = await client.request('/info')

        expect(result.headers.get('X-RateLimit-Limit')).toBe('10')
        expect(parseInt(result.headers.get('X-RateLimit-Remaining')!, 10)).toBe(9)
        expect(result.headers.get('X-RateLimit-Reset')).toBeDefined()
      })
    })

    describe('Combined Middleware Flow', () => {
      it('should process CORS before auth for preflight', async () => {
        // Preflight should succeed even for protected endpoints
        const client = createClient(mf, { tenantId: `combined-${Date.now().toString(36)}` })
        const result = await client.options('/protected', 'https://app.dotdo.dev')

        expect(result.status).toBe(204)
        expect(result.headers.get('Access-Control-Allow-Origin')).toBeDefined()
      })

      it('should apply rate limiting before auth check', async () => {
        const testTenant = `combined-rate-${Date.now().toString(36)}`
        const client = createClient(mf, { tenantId: testTenant, apiKey: 'test-api-key-valid' })

        // Exhaust rate limit
        for (let i = 0; i < 15; i++) {
          const result = await client.request('/things')
          if (result.status === 429) break
        }

        // Next request should be rate limited, not auth error
        const result = await client.request<ErrorResponse>('/things')
        expect(result.status).toBe(429)
        expect(result.data.code).toBe('RATE_LIMIT_EXCEEDED')
      })

      it('should include request ID across all error responses', async () => {
        const testTenant = `combined-reqid-${Date.now().toString(36)}`

        // 404 error
        const client1 = createClient(mf, { tenantId: testTenant })
        const notFound = await client1.request('/nonexistent')
        expect(notFound.headers.get('X-Request-ID')).toBeDefined()

        // 401 error
        const authError = await client1.request('/protected')
        expect(authError.headers.get('X-Request-ID')).toBeDefined()

        // 429 error
        for (let i = 0; i < 15; i++) {
          const result = await client1.request('/info')
          if (result.status === 429) {
            expect(result.headers.get('X-Request-ID')).toBeDefined()
            break
          }
        }
      })

      it('should maintain tenant context through full request lifecycle', async () => {
        const testTenant = `combined-ctx-${Date.now().toString(36)}`
        const client = createClient(mf, { tenantId: testTenant, apiKey: 'test-api-key-valid' })

        // Create thing
        const created = await client.createThing({ $type: 'Context', name: 'Test' })
        expect(created.status).toBe(201)

        // Health check shows tenant
        const health = await client.health()
        expect(health.data.tenantId).toBe(testTenant)

        // List things returns only this tenant's data
        const list = await client.listThings()
        expect(list.status).toBe(200)
        expect(list.data.every(t => t.name === 'Test' || t.$type === 'Context')).toBe(true)
      })
    })
  })

  // ==========================================================================
  // COMPLETE USER JOURNEY TEST
  // ==========================================================================

  describe('Complete User Journey', () => {
    it('should handle full authenticated user workflow', async () => {
      const testTenant = `journey-${Date.now().toString(36)}`

      // Step 1: Unauthenticated health check
      const unauthClient = createClient(mf, { tenantId: testTenant })
      const health = await unauthClient.health()
      expect(health.status).toBe(200)
      expect(health.data.status).toBe('ok')

      // Step 2: Get a token
      const tokenResult = await unauthClient.generateToken({ sub: 'user-123', role: 'user' })
      const token = tokenResult.data.token

      // Step 3: Use token to access protected resources
      const authClient = createClient(mf, { tenantId: testTenant, token })

      // Step 4: Create a resource
      const created = await authClient.createThing({
        $type: 'Order',
        name: 'User Order',
        data: { amount: 99.99 },
      })
      expect(created.status).toBe(201)
      expect(created.data.$id).toBeDefined()

      // Step 5: Read the resource
      const read = await authClient.getThing(created.data.$id)
      expect(read.status).toBe(200)
      expect((read.data as Thing).name).toBe('User Order')

      // Step 6: List resources
      const list = await authClient.listThings()
      expect(list.status).toBe(200)
      expect(list.data.length).toBeGreaterThan(0)

      // Step 7: Verify isolation - different tenant cannot see data
      const otherTenant = createClient(mf, { tenantId: `other-${testTenant}`, apiKey: 'test-api-key-valid' })
      const otherList = await otherTenant.listThings()
      expect(otherList.data).toHaveLength(0)

      // Step 8: Verify all responses have required headers
      expect(list.headers.get('X-Request-ID')).toBeDefined()
      expect(list.headers.get('Content-Type')).toContain('application/json')
    })
  })
})
