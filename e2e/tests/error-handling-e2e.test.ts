/**
 * E2E Error Handling Tests
 *
 * Tests comprehensive error handling with REAL DO instances:
 * 1. HTTP error codes (400, 401, 403, 404, 409, 429, 500)
 * 2. Validation errors
 * 3. Rate limiting and throttling
 * 4. Timeout handling
 * 5. Malformed request handling
 * 6. Concurrent error scenarios
 * 7. Recovery from errors
 * 8. Error message consistency
 *
 * NO MOCKS - uses real Miniflare instances to test true integration.
 *
 * @module e2e/tests/error-handling-e2e.test
 * @see do-oojf
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Miniflare } from 'miniflare'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface ErrorResponse {
  error: string
  code: string
  message?: string
  details?: Record<string, unknown>
  status?: number
  requestId?: string
}

// ============================================================================
// ERROR DO SCRIPT - Comprehensive Error Handling
// ============================================================================

const ERROR_DO_SCRIPT = `
// ============================================================================
// UTILITIES
// ============================================================================

function generateId(prefix = 'id') {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8)
}

function generateRequestId() {
  return 'req-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 6)
}

// ============================================================================
// RATE LIMITER
// ============================================================================

class RateLimiter {
  constructor(storage, key, options = {}) {
    this.storage = storage
    this.key = key
    this.limit = options.limit || 10
    this.windowMs = options.windowMs || 60000
  }

  async check() {
    const now = Date.now()
    const state = await this.storage.get(this.key) || { requests: [], windowStart: now }

    // Remove old requests
    state.requests = state.requests.filter(t => t > now - this.windowMs)

    const remaining = Math.max(0, this.limit - state.requests.length)
    const resetTime = Math.ceil((now + this.windowMs) / 1000)

    if (state.requests.length >= this.limit) {
      const retryAfter = Math.ceil((state.requests[0] + this.windowMs - now) / 1000)
      return {
        allowed: false,
        remaining: 0,
        limit: this.limit,
        resetTime,
        retryAfter
      }
    }

    state.requests.push(now)
    await this.storage.put(this.key, state)

    return {
      allowed: true,
      remaining: remaining - 1,
      limit: this.limit,
      resetTime
    }
  }

  async reset() {
    await this.storage.delete(this.key)
  }
}

// ============================================================================
// ERROR DO CLASS
// ============================================================================

export class ErrorDO {
  constructor(state, env) {
    this.state = state
    this.storage = state.storage
    this.env = env
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method
    const requestId = generateRequestId()

    // Standard error response builder
    const errorResponse = (status, code, message, details = null) => {
      const body = {
        error: code,
        code,
        message,
        status,
        requestId,
        ...(details && { details })
      }
      return Response.json(body, {
        status,
        headers: {
          'X-Request-ID': requestId,
          'Content-Type': 'application/json'
        }
      })
    }

    // ========================================================================
    // HEALTH & INFO
    // ========================================================================

    if (path === '/health') {
      return Response.json({ status: 'ok', requestId })
    }

    // ========================================================================
    // RATE LIMITED ENDPOINTS
    // ========================================================================

    if (path === '/rate-limited') {
      const limiter = new RateLimiter(this.storage, 'rate:' + (request.headers.get('X-Tenant-ID') || 'default'), {
        limit: 5,
        windowMs: 60000
      })

      const result = await limiter.check()

      const headers = new Headers({
        'X-Request-ID': requestId,
        'Content-Type': 'application/json',
        'X-RateLimit-Limit': result.limit.toString(),
        'X-RateLimit-Remaining': result.remaining.toString(),
        'X-RateLimit-Reset': result.resetTime.toString()
      })

      if (!result.allowed) {
        headers.set('Retry-After', result.retryAfter.toString())
        return Response.json({
          error: 'RATE_LIMIT_EXCEEDED',
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests',
          status: 429,
          requestId,
          details: {
            retryAfter: result.retryAfter,
            limit: result.limit,
            resetTime: result.resetTime
          }
        }, { status: 429, headers })
      }

      return Response.json({ message: 'Request allowed', remaining: result.remaining }, { headers })
    }

    if (path === '/reset-rate-limit' && method === 'POST') {
      const limiter = new RateLimiter(this.storage, 'rate:' + (request.headers.get('X-Tenant-ID') || 'default'))
      await limiter.reset()
      return Response.json({ message: 'Rate limit reset' })
    }

    // ========================================================================
    // VALIDATION ENDPOINTS
    // ========================================================================

    if (path === '/validate' && method === 'POST') {
      let data
      try {
        data = await request.json()
      } catch {
        return errorResponse(400, 'PARSE_ERROR', 'Invalid JSON body')
      }

      const errors = []

      if (!data.name) {
        errors.push({ field: 'name', message: 'Name is required' })
      } else if (typeof data.name !== 'string') {
        errors.push({ field: 'name', message: 'Name must be a string' })
      } else if (data.name.length < 2) {
        errors.push({ field: 'name', message: 'Name must be at least 2 characters' })
      } else if (data.name.length > 100) {
        errors.push({ field: 'name', message: 'Name must be at most 100 characters' })
      }

      if (!data.email) {
        errors.push({ field: 'email', message: 'Email is required' })
      } else if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(data.email)) {
        errors.push({ field: 'email', message: 'Invalid email format' })
      }

      if (data.age !== undefined) {
        if (typeof data.age !== 'number') {
          errors.push({ field: 'age', message: 'Age must be a number' })
        } else if (data.age < 0 || data.age > 150) {
          errors.push({ field: 'age', message: 'Age must be between 0 and 150' })
        }
      }

      if (errors.length > 0) {
        return Response.json({
          error: 'VALIDATION_ERROR',
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          status: 400,
          requestId,
          details: { errors }
        }, {
          status: 400,
          headers: { 'X-Request-ID': requestId }
        })
      }

      return Response.json({ valid: true, data, requestId })
    }

    // ========================================================================
    // AUTH ENDPOINTS
    // ========================================================================

    if (path === '/auth-required') {
      const authHeader = request.headers.get('Authorization')

      if (!authHeader) {
        return errorResponse(401, 'AUTH_REQUIRED', 'Authentication required')
      }

      if (!authHeader.startsWith('Bearer ')) {
        return errorResponse(401, 'INVALID_AUTH_FORMAT', 'Authorization header must use Bearer scheme')
      }

      const token = authHeader.slice(7)

      if (token === 'invalid') {
        return errorResponse(401, 'INVALID_TOKEN', 'The provided token is invalid')
      }

      if (token === 'expired') {
        return errorResponse(401, 'TOKEN_EXPIRED', 'The token has expired')
      }

      return Response.json({ message: 'Authenticated', requestId })
    }

    if (path === '/admin-only') {
      const authHeader = request.headers.get('Authorization')

      if (!authHeader) {
        return errorResponse(401, 'AUTH_REQUIRED', 'Authentication required')
      }

      const token = authHeader.slice(7)

      if (token !== 'admin-token') {
        return errorResponse(403, 'FORBIDDEN', 'Admin access required')
      }

      return Response.json({ message: 'Admin access granted', requestId })
    }

    // ========================================================================
    // RESOURCE ENDPOINTS
    // ========================================================================

    if (path === '/resources' && method === 'POST') {
      let data
      try {
        data = await request.json()
      } catch {
        return errorResponse(400, 'PARSE_ERROR', 'Invalid JSON body')
      }

      if (!data.id) {
        return errorResponse(400, 'MISSING_ID', 'Resource ID is required')
      }

      // Check for conflict
      const existing = await this.storage.get('resource:' + data.id)
      if (existing) {
        return errorResponse(409, 'CONFLICT', 'Resource with this ID already exists', {
          existingId: data.id
        })
      }

      const resource = { ...data, createdAt: Date.now() }
      await this.storage.put('resource:' + data.id, resource)

      return Response.json(resource, { status: 201 })
    }

    const resourceMatch = path.match(/^\\/resources\\/([^/]+)$/)
    if (resourceMatch) {
      const id = resourceMatch[1]

      if (method === 'GET') {
        const resource = await this.storage.get('resource:' + id)

        if (!resource) {
          return errorResponse(404, 'NOT_FOUND', 'Resource not found', { id })
        }

        return Response.json(resource)
      }

      if (method === 'DELETE') {
        const resource = await this.storage.get('resource:' + id)

        if (!resource) {
          return errorResponse(404, 'NOT_FOUND', 'Resource not found', { id })
        }

        await this.storage.delete('resource:' + id)
        return new Response(null, { status: 204 })
      }
    }

    // ========================================================================
    // SIMULATED ERROR ENDPOINTS
    // ========================================================================

    if (path === '/simulate/timeout') {
      // Simulate a timeout by waiting (in real scenario, this would timeout)
      const delay = parseInt(url.searchParams.get('delay') || '5000', 10)
      await new Promise(resolve => setTimeout(resolve, Math.min(delay, 1000)))
      return Response.json({ message: 'Completed after delay', delay: Math.min(delay, 1000) })
    }

    if (path === '/simulate/internal-error') {
      return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred')
    }

    if (path === '/simulate/service-unavailable') {
      return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable', {
        retryAfter: 30
      })
    }

    if (path === '/simulate/bad-gateway') {
      return errorResponse(502, 'BAD_GATEWAY', 'Upstream service error')
    }

    if (path === '/simulate/throw' && method === 'POST') {
      try {
        // Intentionally throw
        throw new Error('Simulated server error')
      } catch (error) {
        return errorResponse(500, 'INTERNAL_ERROR', 'Server error: ' + error.message)
      }
    }

    // ========================================================================
    // MALFORMED REQUEST HANDLING
    // ========================================================================

    if (path === '/echo-body' && method === 'POST') {
      const contentType = request.headers.get('Content-Type')

      if (contentType && !contentType.includes('application/json')) {
        return errorResponse(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json')
      }

      try {
        const data = await request.json()
        return Response.json({ received: data, requestId })
      } catch {
        return errorResponse(400, 'PARSE_ERROR', 'Could not parse request body as JSON')
      }
    }

    // ========================================================================
    // METHOD NOT ALLOWED
    // ========================================================================

    if (path === '/get-only') {
      if (method !== 'GET') {
        return Response.json({
          error: 'METHOD_NOT_ALLOWED',
          code: 'METHOD_NOT_ALLOWED',
          message: 'Only GET method is allowed',
          status: 405,
          requestId,
          details: { allowedMethods: ['GET'] }
        }, {
          status: 405,
          headers: {
            'Allow': 'GET',
            'X-Request-ID': requestId
          }
        })
      }
      return Response.json({ message: 'GET allowed', requestId })
    }

    // ========================================================================
    // IDEMPOTENCY
    // ========================================================================

    if (path === '/idempotent' && method === 'POST') {
      const idempotencyKey = request.headers.get('Idempotency-Key')

      if (!idempotencyKey) {
        return errorResponse(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required for this endpoint')
      }

      const existing = await this.storage.get('idempotent:' + idempotencyKey)
      if (existing) {
        return Response.json({
          ...existing,
          _cached: true
        }, {
          headers: { 'X-Idempotent-Replayed': 'true' }
        })
      }

      const data = await request.json().catch(() => ({}))
      const result = {
        id: generateId('result'),
        data,
        createdAt: Date.now()
      }

      await this.storage.put('idempotent:' + idempotencyKey, result)
      return Response.json(result, { status: 201 })
    }

    // ========================================================================
    // RPC ERRORS
    // ========================================================================

    if (path === '/rpc' && method === 'POST') {
      let body
      try {
        body = await request.json()
      } catch {
        return errorResponse(400, 'PARSE_ERROR', 'Invalid JSON body')
      }

      if (!body.method) {
        return errorResponse(400, 'MISSING_METHOD', 'RPC method is required')
      }

      const fn = this[body.method]
      if (typeof fn !== 'function') {
        return errorResponse(404, 'METHOD_NOT_FOUND', 'RPC method not found: ' + body.method)
      }

      try {
        const result = await fn.apply(this, body.args || [])
        return Response.json({ result, requestId })
      } catch (error) {
        return errorResponse(500, 'RPC_ERROR', 'RPC execution failed: ' + error.message)
      }
    }

    // ========================================================================
    // NOT FOUND
    // ========================================================================

    return errorResponse(404, 'NOT_FOUND', 'Endpoint not found: ' + path)
  }

  // RPC methods
  async echo(message) {
    return { echo: message }
  }

  async fail() {
    throw new Error('Intentional failure')
  }

  async divide(a, b) {
    if (b === 0) {
      throw new Error('Division by zero')
    }
    return a / b
  }
}

// ============================================================================
// WORKER
// ============================================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    let namespace = 'default'

    const tenantHeader = request.headers.get('X-Tenant-ID')
    if (tenantHeader) {
      namespace = tenantHeader
    }

    const id = env.ERROR_DO.idFromName(namespace)
    const stub = env.ERROR_DO.get(id)

    return stub.fetch(request)
  }
}
`

// ============================================================================
// TEST HELPERS
// ============================================================================

function createErrorClient(mf: Miniflare, tenantId: string = 'default') {
  return {
    async request<T = unknown>(
      path: string,
      options: RequestInit & { token?: string } = {}
    ): Promise<{ status: number; data: T; headers: Headers }> {
      const headers = new Headers(options.headers)
      headers.set('Content-Type', 'application/json')
      headers.set('X-Tenant-ID', tenantId)

      if (options.token) {
        headers.set('Authorization', `Bearer ${options.token}`)
      }

      const response = await mf.dispatchFetch(`http://localhost${path}`, {
        ...options,
        headers,
      })

      if (response.status === 204) {
        return { status: response.status, data: undefined as T, headers: response.headers }
      }

      const data = await response.json() as T
      return { status: response.status, data, headers: response.headers }
    },

    async health() {
      return this.request<{ status: string }>('/health')
    },
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('E2E Error Handling Tests', () => {
  let mf: Miniflare

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: ERROR_DO_SCRIPT,
      durableObjects: {
        ERROR_DO: 'ErrorDO',
      },
    })
  })

  afterAll(async () => {
    await mf.dispose()
  })

  // ==========================================================================
  // 1. HTTP ERROR CODES
  // ==========================================================================

  describe('HTTP Error Codes', () => {
    it('should return 400 Bad Request for parse errors', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `400-${testId}`)

      const response = await mf.dispatchFetch('http://localhost/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': `400-${testId}`,
        },
        body: 'not json',
      })

      const data = await response.json() as ErrorResponse

      expect(response.status).toBe(400)
      expect(data.code).toBe('PARSE_ERROR')
    })

    it('should return 401 Unauthorized for missing auth', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `401-${testId}`)

      const result = await client.request<ErrorResponse>('/auth-required')

      expect(result.status).toBe(401)
      expect(result.data.code).toBe('AUTH_REQUIRED')
    })

    it('should return 401 for invalid token', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `401-invalid-${testId}`)

      const result = await client.request<ErrorResponse>('/auth-required', {
        token: 'invalid',
      })

      expect(result.status).toBe(401)
      expect(result.data.code).toBe('INVALID_TOKEN')
    })

    it('should return 401 for expired token', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `401-expired-${testId}`)

      const result = await client.request<ErrorResponse>('/auth-required', {
        token: 'expired',
      })

      expect(result.status).toBe(401)
      expect(result.data.code).toBe('TOKEN_EXPIRED')
    })

    it('should return 403 Forbidden for insufficient permissions', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `403-${testId}`)

      const result = await client.request<ErrorResponse>('/admin-only', {
        token: 'user-token',
      })

      expect(result.status).toBe(403)
      expect(result.data.code).toBe('FORBIDDEN')
    })

    it('should return 404 Not Found for missing resource', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `404-${testId}`)

      const result = await client.request<ErrorResponse>('/resources/nonexistent')

      expect(result.status).toBe(404)
      expect(result.data.code).toBe('NOT_FOUND')
      expect(result.data.details).toHaveProperty('id')
    })

    it('should return 404 Not Found for unknown endpoint', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `404-unknown-${testId}`)

      const result = await client.request<ErrorResponse>('/unknown/endpoint')

      expect(result.status).toBe(404)
      expect(result.data.code).toBe('NOT_FOUND')
    })

    it('should return 405 Method Not Allowed', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `405-${testId}`)

      const result = await client.request<ErrorResponse>('/get-only', {
        method: 'POST',
      })

      expect(result.status).toBe(405)
      expect(result.data.code).toBe('METHOD_NOT_ALLOWED')
      expect(result.headers.get('Allow')).toBe('GET')
    })

    it('should return 409 Conflict for duplicate resource', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `409-${testId}`)

      // Create first resource
      await client.request('/resources', {
        method: 'POST',
        body: JSON.stringify({ id: 'duplicate-id', name: 'First' }),
      })

      // Try to create duplicate
      const result = await client.request<ErrorResponse>('/resources', {
        method: 'POST',
        body: JSON.stringify({ id: 'duplicate-id', name: 'Second' }),
      })

      expect(result.status).toBe(409)
      expect(result.data.code).toBe('CONFLICT')
    })

    it('should return 415 Unsupported Media Type', async () => {
      const testId = Date.now().toString(36)

      const response = await mf.dispatchFetch('http://localhost/echo-body', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'X-Tenant-ID': `415-${testId}`,
        },
        body: 'plain text',
      })

      const data = await response.json() as ErrorResponse

      expect(response.status).toBe(415)
      expect(data.code).toBe('UNSUPPORTED_MEDIA_TYPE')
    })

    it('should return 429 Too Many Requests', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `429-${testId}`)

      // Reset rate limit first
      await client.request('/reset-rate-limit', { method: 'POST' })

      // Make 6 requests (limit is 5)
      for (let i = 0; i < 6; i++) {
        const result = await client.request<{ message?: string } | ErrorResponse>('/rate-limited')

        if (i < 5) {
          expect(result.status).toBe(200)
        } else {
          expect(result.status).toBe(429)
          expect((result.data as ErrorResponse).code).toBe('RATE_LIMIT_EXCEEDED')
          expect(result.headers.get('Retry-After')).toBeDefined()
        }
      }
    })

    it('should return 500 Internal Server Error', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `500-${testId}`)

      const result = await client.request<ErrorResponse>('/simulate/internal-error')

      expect(result.status).toBe(500)
      expect(result.data.code).toBe('INTERNAL_ERROR')
    })

    it('should return 502 Bad Gateway', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `502-${testId}`)

      const result = await client.request<ErrorResponse>('/simulate/bad-gateway')

      expect(result.status).toBe(502)
      expect(result.data.code).toBe('BAD_GATEWAY')
    })

    it('should return 503 Service Unavailable', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `503-${testId}`)

      const result = await client.request<ErrorResponse>('/simulate/service-unavailable')

      expect(result.status).toBe(503)
      expect(result.data.code).toBe('SERVICE_UNAVAILABLE')
      expect(result.data.details).toHaveProperty('retryAfter')
    })
  })

  // ==========================================================================
  // 2. VALIDATION ERRORS
  // ==========================================================================

  describe('Validation Errors', () => {
    it('should return validation errors for missing required fields', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `validation-${testId}`)

      const result = await client.request<ErrorResponse>('/validate', {
        method: 'POST',
        body: JSON.stringify({}),
      })

      expect(result.status).toBe(400)
      expect(result.data.code).toBe('VALIDATION_ERROR')
      expect(result.data.details?.errors).toHaveLength(2) // name and email
    })

    it('should return validation error for invalid email', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `validation-email-${testId}`)

      const result = await client.request<ErrorResponse>('/validate', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test', email: 'not-an-email' }),
      })

      expect(result.status).toBe(400)
      expect(result.data.code).toBe('VALIDATION_ERROR')
      const errors = result.data.details?.errors as { field: string }[]
      expect(errors.some(e => e.field === 'email')).toBe(true)
    })

    it('should return validation error for name too short', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `validation-short-${testId}`)

      const result = await client.request<ErrorResponse>('/validate', {
        method: 'POST',
        body: JSON.stringify({ name: 'A', email: 'test@example.com' }),
      })

      expect(result.status).toBe(400)
      const errors = result.data.details?.errors as { field: string; message: string }[]
      expect(errors.some(e => e.field === 'name' && e.message.includes('2 characters'))).toBe(true)
    })

    it('should return validation error for invalid age', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `validation-age-${testId}`)

      const result = await client.request<ErrorResponse>('/validate', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test', email: 'test@example.com', age: 200 }),
      })

      expect(result.status).toBe(400)
      const errors = result.data.details?.errors as { field: string }[]
      expect(errors.some(e => e.field === 'age')).toBe(true)
    })

    it('should accept valid data', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `validation-valid-${testId}`)

      const result = await client.request<{ valid: boolean }>('/validate', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test User', email: 'test@example.com', age: 25 }),
      })

      expect(result.status).toBe(200)
      expect(result.data.valid).toBe(true)
    })
  })

  // ==========================================================================
  // 3. RATE LIMITING
  // ==========================================================================

  describe('Rate Limiting', () => {
    it('should include rate limit headers', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `ratelimit-headers-${testId}`)

      await client.request('/reset-rate-limit', { method: 'POST' })
      const result = await client.request('/rate-limited')

      expect(result.headers.get('X-RateLimit-Limit')).toBeDefined()
      expect(result.headers.get('X-RateLimit-Remaining')).toBeDefined()
      expect(result.headers.get('X-RateLimit-Reset')).toBeDefined()
    })

    it('should decrement remaining count', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `ratelimit-decrement-${testId}`)

      await client.request('/reset-rate-limit', { method: 'POST' })

      const first = await client.request('/rate-limited')
      const second = await client.request('/rate-limited')

      const firstRemaining = parseInt(first.headers.get('X-RateLimit-Remaining') || '0', 10)
      const secondRemaining = parseInt(second.headers.get('X-RateLimit-Remaining') || '0', 10)

      expect(secondRemaining).toBe(firstRemaining - 1)
    })

    it('should isolate rate limits per tenant', async () => {
      const testId = Date.now().toString(36)
      const clientA = createErrorClient(mf, `ratelimit-a-${testId}`)
      const clientB = createErrorClient(mf, `ratelimit-b-${testId}`)

      // Reset both
      await clientA.request('/reset-rate-limit', { method: 'POST' })
      await clientB.request('/reset-rate-limit', { method: 'POST' })

      // Exhaust rate limit for tenant A
      for (let i = 0; i < 6; i++) {
        await clientA.request('/rate-limited')
      }

      // Tenant B should still have quota
      const resultB = await clientB.request('/rate-limited')
      expect(resultB.status).toBe(200)
    })
  })

  // ==========================================================================
  // 4. MALFORMED REQUEST HANDLING
  // ==========================================================================

  describe('Malformed Request Handling', () => {
    it('should handle invalid JSON body', async () => {
      const testId = Date.now().toString(36)

      const response = await mf.dispatchFetch('http://localhost/echo-body', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': `malformed-${testId}`,
        },
        body: '{invalid json}',
      })

      const data = await response.json() as ErrorResponse

      expect(response.status).toBe(400)
      expect(data.code).toBe('PARSE_ERROR')
    })

    it('should handle empty body', async () => {
      const testId = Date.now().toString(36)

      const response = await mf.dispatchFetch('http://localhost/echo-body', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': `empty-${testId}`,
        },
        body: '',
      })

      const data = await response.json() as ErrorResponse

      expect(response.status).toBe(400)
      expect(data.code).toBe('PARSE_ERROR')
    })

    it('should handle truncated JSON', async () => {
      const testId = Date.now().toString(36)

      const response = await mf.dispatchFetch('http://localhost/echo-body', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': `truncated-${testId}`,
        },
        body: '{"name": "test',
      })

      const data = await response.json() as ErrorResponse

      expect(response.status).toBe(400)
      expect(data.code).toBe('PARSE_ERROR')
    })
  })

  // ==========================================================================
  // 5. RPC ERROR HANDLING
  // ==========================================================================

  describe('RPC Error Handling', () => {
    it('should handle missing RPC method name', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `rpc-${testId}`)

      const result = await client.request<ErrorResponse>('/rpc', {
        method: 'POST',
        body: JSON.stringify({}),
      })

      expect(result.status).toBe(400)
      expect(result.data.code).toBe('MISSING_METHOD')
    })

    it('should handle unknown RPC method', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `rpc-unknown-${testId}`)

      const result = await client.request<ErrorResponse>('/rpc', {
        method: 'POST',
        body: JSON.stringify({ method: 'unknownMethod' }),
      })

      expect(result.status).toBe(404)
      expect(result.data.code).toBe('METHOD_NOT_FOUND')
    })

    it('should handle RPC execution errors', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `rpc-exec-${testId}`)

      const result = await client.request<ErrorResponse>('/rpc', {
        method: 'POST',
        body: JSON.stringify({ method: 'fail' }),
      })

      expect(result.status).toBe(500)
      expect(result.data.code).toBe('RPC_ERROR')
    })

    it('should handle division by zero', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `rpc-div-${testId}`)

      const result = await client.request<ErrorResponse>('/rpc', {
        method: 'POST',
        body: JSON.stringify({ method: 'divide', args: [10, 0] }),
      })

      expect(result.status).toBe(500)
      expect(result.data.code).toBe('RPC_ERROR')
      expect(result.data.message).toContain('zero')
    })
  })

  // ==========================================================================
  // 6. IDEMPOTENCY
  // ==========================================================================

  describe('Idempotency', () => {
    it('should require Idempotency-Key header', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `idemp-${testId}`)

      const result = await client.request<ErrorResponse>('/idempotent', {
        method: 'POST',
        body: JSON.stringify({ data: 'test' }),
      })

      expect(result.status).toBe(400)
      expect(result.data.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    })

    it('should return cached response for duplicate idempotent request', async () => {
      const testId = Date.now().toString(36)
      const idempotencyKey = `key-${testId}`

      const response1 = await mf.dispatchFetch('http://localhost/idempotent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': `idemp-cache-${testId}`,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ data: 'first' }),
      })

      const data1 = await response1.json() as { id: string }
      expect(response1.status).toBe(201)

      const response2 = await mf.dispatchFetch('http://localhost/idempotent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': `idemp-cache-${testId}`,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ data: 'second' }), // Different data
      })

      const data2 = await response2.json() as { id: string; _cached?: boolean }

      // Should return same result (cached)
      expect(data2.id).toBe(data1.id)
      expect(data2._cached).toBe(true)
      expect(response2.headers.get('X-Idempotent-Replayed')).toBe('true')
    })
  })

  // ==========================================================================
  // 7. ERROR MESSAGE CONSISTENCY
  // ==========================================================================

  describe('Error Message Consistency', () => {
    it('should include request ID in all error responses', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `reqid-${testId}`)

      const errors = [
        { path: '/unknown', method: 'GET' }, // 404
        { path: '/auth-required', method: 'GET' }, // 401
        { path: '/validate', method: 'POST', body: '{}' }, // 400
      ]

      for (const err of errors) {
        const result = await client.request<ErrorResponse>(err.path, {
          method: err.method,
          ...(err.body && { body: err.body }),
        })

        expect(result.data.requestId).toBeDefined()
        expect(result.headers.get('X-Request-ID')).toBeDefined()
      }
    })

    it('should include status in error body', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `status-${testId}`)

      const result = await client.request<ErrorResponse>('/unknown')

      expect(result.data.status).toBe(404)
      expect(result.status).toBe(404)
    })

    it('should have consistent error structure', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `structure-${testId}`)

      const result = await client.request<ErrorResponse>('/unknown')

      // All errors should have these fields
      expect(result.data).toHaveProperty('error')
      expect(result.data).toHaveProperty('code')
      expect(result.data).toHaveProperty('message')
      expect(result.data).toHaveProperty('status')
      expect(result.data).toHaveProperty('requestId')
    })
  })

  // ==========================================================================
  // 8. RECOVERY FROM ERRORS
  // ==========================================================================

  describe('Recovery from Errors', () => {
    it('should recover after rate limit resets', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `recover-rate-${testId}`)

      // Exhaust rate limit
      for (let i = 0; i < 6; i++) {
        await client.request('/rate-limited')
      }

      // Should be rate limited
      const limited = await client.request<ErrorResponse>('/rate-limited')
      expect(limited.status).toBe(429)

      // Reset rate limit
      await client.request('/reset-rate-limit', { method: 'POST' })

      // Should be allowed again
      const recovered = await client.request('/rate-limited')
      expect(recovered.status).toBe(200)
    })

    it('should handle deleted resource gracefully', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `recover-delete-${testId}`)

      // Create resource
      await client.request('/resources', {
        method: 'POST',
        body: JSON.stringify({ id: 'to-delete', name: 'Test' }),
      })

      // Delete it
      await client.request('/resources/to-delete', { method: 'DELETE' })

      // Should get 404 but not crash
      const result = await client.request<ErrorResponse>('/resources/to-delete')
      expect(result.status).toBe(404)
      expect(result.data.code).toBe('NOT_FOUND')
    })

    it('should continue working after internal error', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `recover-internal-${testId}`)

      // Trigger internal error
      await client.request('/simulate/internal-error')

      // Should still be able to make requests
      const health = await client.health()
      expect(health.status).toBe(200)
    })
  })

  // ==========================================================================
  // 9. CONCURRENT ERROR SCENARIOS
  // ==========================================================================

  describe('Concurrent Error Scenarios', () => {
    it('should handle concurrent validation errors', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `concurrent-val-${testId}`)

      const promises = Array.from({ length: 10 }, (_, i) =>
        client.request<ErrorResponse>('/validate', {
          method: 'POST',
          body: JSON.stringify({ invalid: i }),
        })
      )

      const results = await Promise.all(promises)

      // All should return validation errors
      expect(results.every(r => r.status === 400)).toBe(true)
      expect(results.every(r => r.data.code === 'VALIDATION_ERROR')).toBe(true)
    })

    it('should handle concurrent rate limit checks', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `concurrent-rate-${testId}`)

      await client.request('/reset-rate-limit', { method: 'POST' })

      // Fire 10 concurrent requests (limit is 5)
      const promises = Array.from({ length: 10 }, () =>
        client.request('/rate-limited')
      )

      const results = await Promise.all(promises)

      // Some should succeed, some should be rate limited
      const successful = results.filter(r => r.status === 200)
      const rateLimited = results.filter(r => r.status === 429)

      expect(successful.length).toBe(5)
      expect(rateLimited.length).toBe(5)
    })

    it('should handle concurrent resource conflicts', async () => {
      const testId = Date.now().toString(36)
      const client = createErrorClient(mf, `concurrent-conflict-${testId}`)

      // Try to create same resource concurrently
      const promises = Array.from({ length: 5 }, () =>
        client.request('/resources', {
          method: 'POST',
          body: JSON.stringify({ id: 'same-id', name: 'Test' }),
        })
      )

      const results = await Promise.all(promises)

      // Only one should succeed
      const created = results.filter(r => r.status === 201)
      const conflicted = results.filter(r => r.status === 409)

      expect(created.length).toBe(1)
      expect(conflicted.length).toBe(4)
    })
  })
})
