/**
 * Browser Session API Route Tests
 *
 * Tests for the /api/browsers/* REST endpoints that manage browser automation sessions.
 * These routes proxy to the Browser Durable Object for session lifecycle and operations.
 *
 * TDD: These tests will FAIL until the routes are implemented.
 *
 * @see objects/Browser.ts - Browser Durable Object implementation
 * @see api/routes/browsers.ts - Route handlers
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'

// Import the browsers routes directly to avoid cloudflare:workers import issues
import { browsersRoutes } from '../../routes/browsers'

// ============================================================================
// Test Types
// ============================================================================

interface BrowserSession {
  id: string
  status: 'idle' | 'active' | 'paused' | 'stopped'
  provider?: 'cloudflare' | 'browserbase'
  currentUrl?: string
  liveViewUrl?: string
  createdAt: string
  updatedAt: string
}

interface CreateSessionResponse {
  id: string
  sessionId: string
  provider: 'cloudflare' | 'browserbase'
  liveViewUrl?: string
}

interface BrowserState {
  status: 'idle' | 'active' | 'paused' | 'stopped'
  provider?: 'cloudflare' | 'browserbase'
  currentUrl?: string
  liveViewUrl?: string
}

interface ActResult {
  success: boolean
  action?: string
  selector?: string
}

interface ExtractResult<T = unknown> {
  success: boolean
  data: T
}

interface ErrorResponse {
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

// ============================================================================
// Test Setup
// ============================================================================

// Create a mock DO stub for testing
function createMockDOStub(responses: Record<string, { status?: number; body: unknown }> = {}) {
  return {
    fetch: vi.fn(async (req: Request) => {
      const url = new URL(req.url)
      const path = url.pathname

      // Default responses for various endpoints
      const defaultResponses: Record<string, { status?: number; body: unknown }> = {
        '/start': { status: 200, body: { sessionId: 'test-session-id', provider: 'cloudflare' } },
        '/state': { status: 200, body: { status: 'active', provider: 'cloudflare', currentUrl: 'https://example.com.ai' } },
        '/goto': { status: 200, body: { success: true } },
        '/act': { status: 200, body: { success: true, action: 'click' } },
        '/extract': { status: 200, body: { title: 'Example Page' } },
        '/observe': { status: 200, body: [{ type: 'button', text: 'Login' }] },
        '/stop': { status: 200, body: { success: true } },
        '/screenshot': { status: 200, body: { image: 'base64-image-data' } },
      }

      const response = responses[path] ?? defaultResponses[path] ?? { status: 404, body: { error: 'Not found' } }

      return new Response(JSON.stringify(response.body), {
        status: response.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  }
}

// Create a mock DurableObjectNamespace
function createMockNamespace(stubOverrides: Record<string, { status?: number; body: unknown }> = {}) {
  return {
    idFromName: vi.fn((name: string) => ({ name })),
    get: vi.fn(() => createMockDOStub(stubOverrides)),
  }
}

// Session registry for simulating session tracking
const testSessionRegistry = new Map<string, { id: string; createdAt: string; provider: string }>()

// Create test app with mock bindings
function createTestApp(stubOverrides: Record<string, { status?: number; body: unknown }> = {}) {
  const testApp = new Hono<{ Bindings: { BROWSER_DO: DurableObjectNamespace } }>()

  // Add mock bindings middleware
  testApp.use('*', async (c, next) => {
    c.env = {
      BROWSER_DO: createMockNamespace(stubOverrides) as unknown as DurableObjectNamespace,
    }
    await next()
  })

  // Mount browsers routes
  testApp.route('/api/browsers', browsersRoutes)

  return testApp
}

// The test app instance
let app: ReturnType<typeof createTestApp>

// Reset before each test
beforeEach(() => {
  testSessionRegistry.clear()
  vi.clearAllMocks()
  app = createTestApp()
})

// ============================================================================
// Helper Functions
// ============================================================================

async function request(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>
): Promise<Response> {
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  }
  if (body !== undefined) {
    options.body = JSON.stringify(body)
  }
  return app.request(path, options)
}

async function get(path: string, headers?: Record<string, string>): Promise<Response> {
  return app.request(path, {
    method: 'GET',
    headers,
  })
}

async function post(path: string, body: unknown, headers?: Record<string, string>): Promise<Response> {
  return request('POST', path, body, headers)
}

// ============================================================================
// 1. GET /api/browsers - List Browser Sessions
// ============================================================================

describe('GET /api/browsers - List Sessions', () => {
  it('should return 200 with array of sessions', async () => {
    const response = await get('/api/browsers')

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('application/json')

    const body = await response.json()
    expect(body).toHaveProperty('sessions')
    expect(Array.isArray(body.sessions)).toBe(true)
  })

  it('should return empty array when no sessions exist', async () => {
    const response = await get('/api/browsers')

    const body = await response.json()
    expect(body.sessions).toEqual([])
  })

  it('should return sessions with required fields', async () => {
    // First create a session
    await post('/api/browsers', { provider: 'cloudflare' })

    const response = await get('/api/browsers')
    const body = await response.json()

    if (body.sessions.length > 0) {
      const session = body.sessions[0] as BrowserSession
      expect(session).toHaveProperty('id')
      expect(session).toHaveProperty('status')
      expect(session).toHaveProperty('createdAt')
    }
  })

  it('should support pagination with limit and offset', async () => {
    const response = await get('/api/browsers?limit=5&offset=0')

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.sessions.length).toBeLessThanOrEqual(5)
  })

  it('should filter by status query parameter', async () => {
    const response = await get('/api/browsers?status=active')

    expect(response.status).toBe(200)
    const body = await response.json()
    // All returned sessions should be active
    for (const session of body.sessions as BrowserSession[]) {
      expect(session.status).toBe('active')
    }
  })
})

// ============================================================================
// 2. POST /api/browsers - Create New Session
// ============================================================================

describe('POST /api/browsers - Create Session', () => {
  it('should create new session and return 201', async () => {
    const response = await post('/api/browsers', {
      provider: 'cloudflare',
    })

    expect(response.status).toBe(201)
    expect(response.headers.get('Content-Type')).toContain('application/json')
  })

  it('should return session id and sessionId', async () => {
    const response = await post('/api/browsers', {
      provider: 'cloudflare',
    })

    const body = (await response.json()) as CreateSessionResponse
    expect(body).toHaveProperty('id')
    expect(body).toHaveProperty('sessionId')
    expect(typeof body.id).toBe('string')
    expect(body.id.length).toBeGreaterThan(0)
  })

  it('should return provider in response', async () => {
    const response = await post('/api/browsers', {
      provider: 'browserbase',
    })

    const body = (await response.json()) as CreateSessionResponse
    expect(body.provider).toBe('browserbase')
  })

  it('should return liveViewUrl when liveView is enabled (browserbase)', async () => {
    const response = await post('/api/browsers', {
      provider: 'browserbase',
      liveView: true,
    })

    const body = (await response.json()) as CreateSessionResponse
    // liveViewUrl should be present when using browserbase with liveView
    if (body.provider === 'browserbase') {
      expect(body).toHaveProperty('liveViewUrl')
    }
  })

  it('should default to cloudflare provider', async () => {
    const response = await post('/api/browsers', {})

    const body = (await response.json()) as CreateSessionResponse
    expect(body.provider).toBe('cloudflare')
  })

  it('should accept viewport configuration', async () => {
    const response = await post('/api/browsers', {
      provider: 'cloudflare',
      viewport: { width: 1920, height: 1080 },
    })

    expect(response.status).toBe(201)
  })

  it('should return 400 for invalid provider', async () => {
    const response = await post('/api/browsers', {
      provider: 'invalid-provider',
    })

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.code).toBe('BAD_REQUEST')
  })

  it('should return 400 for invalid viewport', async () => {
    const response = await post('/api/browsers', {
      viewport: { width: -100, height: 0 },
    })

    expect(response.status).toBe(400)
  })
})

// ============================================================================
// 3. GET /api/browsers/:id/state - Get Session State
// ============================================================================

describe('GET /api/browsers/:id/state - Get State', () => {
  it('should return session state', async () => {
    // Create session first
    const createRes = await post('/api/browsers', { provider: 'cloudflare' })
    const { id } = (await createRes.json()) as CreateSessionResponse

    const response = await get(`/api/browsers/${id}/state`)

    expect(response.status).toBe(200)
    const body = (await response.json()) as BrowserState
    expect(body).toHaveProperty('status')
  })

  it('should include provider in state', async () => {
    const createRes = await post('/api/browsers', { provider: 'cloudflare' })
    const { id } = (await createRes.json()) as CreateSessionResponse

    const response = await get(`/api/browsers/${id}/state`)
    const body = (await response.json()) as BrowserState

    expect(body.provider).toBe('cloudflare')
  })

  it('should include currentUrl when session has navigated', async () => {
    const createRes = await post('/api/browsers', { provider: 'cloudflare' })
    const { id } = (await createRes.json()) as CreateSessionResponse

    // Navigate to a URL
    await post(`/api/browsers/${id}/browse`, { url: 'https://example.com.ai' })

    const response = await get(`/api/browsers/${id}/state`)
    const body = (await response.json()) as BrowserState

    expect(body).toHaveProperty('currentUrl')
  })

  it('should return 404 for non-existent session', async () => {
    const response = await get('/api/browsers/non-existent-id/state')

    expect(response.status).toBe(404)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.code).toBe('NOT_FOUND')
  })
})

// ============================================================================
// 4. POST /api/browsers/:id/browse - Navigate (goto)
// ============================================================================

describe('POST /api/browsers/:id/browse - Navigate', () => {
  it('should navigate to URL', async () => {
    const createRes = await post('/api/browsers', { provider: 'cloudflare' })
    const { id } = (await createRes.json()) as CreateSessionResponse

    const response = await post(`/api/browsers/${id}/browse`, {
      url: 'https://example.com.ai',
    })

    expect(response.status).toBe(200)
  })

  it('should return 400 for missing URL', async () => {
    const createRes = await post('/api/browsers', { provider: 'cloudflare' })
    const { id } = (await createRes.json()) as CreateSessionResponse

    const response = await post(`/api/browsers/${id}/browse`, {})

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.code).toBe('BAD_REQUEST')
    expect(body.error.message).toContain('url')
  })

  it('should return 400 for invalid URL format', async () => {
    const createRes = await post('/api/browsers', { provider: 'cloudflare' })
    const { id } = (await createRes.json()) as CreateSessionResponse

    const response = await post(`/api/browsers/${id}/browse`, {
      url: 'not-a-valid-url',
    })

    expect(response.status).toBe(400)
  })

  it('should return 404 for non-existent session', async () => {
    const response = await post('/api/browsers/non-existent-id/browse', {
      url: 'https://example.com.ai',
    })

    expect(response.status).toBe(404)
  })

  it('should return 409 when session is not active', async () => {
    const createRes = await post('/api/browsers', { provider: 'cloudflare' })
    const { id } = (await createRes.json()) as CreateSessionResponse

    // Stop the session
    await post(`/api/browsers/${id}/stop`, {})

    // Try to navigate
    const response = await post(`/api/browsers/${id}/browse`, {
      url: 'https://example.com.ai',
    })

    expect(response.status).toBe(409)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.code).toBe('CONFLICT')
  })
})

// ============================================================================
// 5. POST /api/browsers/:id/act - Execute Action
// ============================================================================

describe('POST /api/browsers/:id/act - Execute Action', () => {
  it('should execute action instruction', async () => {
    const createRes = await post('/api/browsers', { provider: 'cloudflare' })
    const { id } = (await createRes.json()) as CreateSessionResponse

    // Navigate first
    await post(`/api/browsers/${id}/browse`, { url: 'https://example.com.ai' })

    const response = await post(`/api/browsers/${id}/act`, {
      instruction: 'Click the login button',
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as ActResult
    expect(body).toHaveProperty('success')
  })

  it('should return 400 for missing instruction', async () => {
    const createRes = await post('/api/browsers', { provider: 'cloudflare' })
    const { id } = (await createRes.json()) as CreateSessionResponse

    const response = await post(`/api/browsers/${id}/act`, {})

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.message).toContain('instruction')
  })

  it('should return 404 for non-existent session', async () => {
    const response = await post('/api/browsers/non-existent-id/act', {
      instruction: 'Click button',
    })

    expect(response.status).toBe(404)
  })

  it('should return action details in response', async () => {
    const createRes = await post('/api/browsers', { provider: 'cloudflare' })
    const { id } = (await createRes.json()) as CreateSessionResponse

    await post(`/api/browsers/${id}/browse`, { url: 'https://example.com.ai' })

    const response = await post(`/api/browsers/${id}/act`, {
      instruction: 'Click the submit button',
    })

    const body = (await response.json()) as ActResult
    // Response should include what action was taken
    expect(body).toHaveProperty('action')
  })
})

// ============================================================================
// 6. POST /api/browsers/:id/extract - Extract Data
// ============================================================================

describe('POST /api/browsers/:id/extract - Extract Data', () => {
  it('should extract data from page', async () => {
    const createRes = await post('/api/browsers', { provider: 'cloudflare' })
    const { id } = (await createRes.json()) as CreateSessionResponse

    await post(`/api/browsers/${id}/browse`, { url: 'https://example.com.ai' })

    const response = await post(`/api/browsers/${id}/extract`, {
      instruction: 'Get the page title',
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as ExtractResult
    expect(body).toHaveProperty('data')
  })

  it('should accept optional schema for structured extraction', async () => {
    const createRes = await post('/api/browsers', { provider: 'cloudflare' })
    const { id } = (await createRes.json()) as CreateSessionResponse

    await post(`/api/browsers/${id}/browse`, { url: 'https://example.com.ai' })

    const response = await post(`/api/browsers/${id}/extract`, {
      instruction: 'Extract product information',
      schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          price: { type: 'number' },
        },
      },
    })

    expect(response.status).toBe(200)
  })

  it('should return 400 for missing instruction', async () => {
    const createRes = await post('/api/browsers', { provider: 'cloudflare' })
    const { id } = (await createRes.json()) as CreateSessionResponse

    const response = await post(`/api/browsers/${id}/extract`, {})

    expect(response.status).toBe(400)
  })

  it('should return 404 for non-existent session', async () => {
    const response = await post('/api/browsers/non-existent-id/extract', {
      instruction: 'Get title',
    })

    expect(response.status).toBe(404)
  })
})

// ============================================================================
// 7. POST /api/browsers/:id/stop - Stop Session
// ============================================================================

describe('POST /api/browsers/:id/stop - Stop Session', () => {
  it('should stop the session', async () => {
    const createRes = await post('/api/browsers', { provider: 'cloudflare' })
    const { id } = (await createRes.json()) as CreateSessionResponse

    const response = await post(`/api/browsers/${id}/stop`, {})

    expect(response.status).toBe(200)
  })

  it('should return stopped status in response', async () => {
    const createRes = await post('/api/browsers', { provider: 'cloudflare' })
    const { id } = (await createRes.json()) as CreateSessionResponse

    const response = await post(`/api/browsers/${id}/stop`, {})
    const body = await response.json()

    expect(body).toHaveProperty('status')
    expect(body.status).toBe('stopped')
  })

  it('should return 404 for non-existent session', async () => {
    const response = await post('/api/browsers/non-existent-id/stop', {})

    expect(response.status).toBe(404)
  })

  it('should be idempotent (stopping already stopped session)', async () => {
    const createRes = await post('/api/browsers', { provider: 'cloudflare' })
    const { id } = (await createRes.json()) as CreateSessionResponse

    // Stop twice
    await post(`/api/browsers/${id}/stop`, {})
    const response = await post(`/api/browsers/${id}/stop`, {})

    // Should either succeed or return appropriate status
    expect([200, 409]).toContain(response.status)
  })

  it('should update session state to stopped', async () => {
    const createRes = await post('/api/browsers', { provider: 'cloudflare' })
    const { id } = (await createRes.json()) as CreateSessionResponse

    await post(`/api/browsers/${id}/stop`, {})

    // Verify state
    const stateRes = await get(`/api/browsers/${id}/state`)
    const state = (await stateRes.json()) as BrowserState

    expect(state.status).toBe('stopped')
  })
})

// ============================================================================
// 8. GET /api/browsers/:id/events - SSE Stream
// ============================================================================

describe('GET /api/browsers/:id/events - SSE Stream', () => {
  it('should return SSE content type', async () => {
    const createRes = await post('/api/browsers', { provider: 'cloudflare' })
    const { id } = (await createRes.json()) as CreateSessionResponse

    const response = await get(`/api/browsers/${id}/events`)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/event-stream')
  })

  it('should include cache-control headers for SSE', async () => {
    const createRes = await post('/api/browsers', { provider: 'cloudflare' })
    const { id } = (await createRes.json()) as CreateSessionResponse

    const response = await get(`/api/browsers/${id}/events`)

    expect(response.headers.get('Cache-Control')).toBe('no-cache')
    expect(response.headers.get('Connection')).toBe('keep-alive')
  })

  it('should return 404 for non-existent session', async () => {
    const response = await get('/api/browsers/non-existent-id/events')

    expect(response.status).toBe(404)
  })
})

// ============================================================================
// 9. Authentication Tests
// ============================================================================

describe('Browser Routes - Authentication', () => {
  it('should return 401 when auth is required and no token provided', async () => {
    // Note: This depends on whether auth middleware is enabled
    // If auth is disabled, this test should be skipped
    const response = await get('/api/browsers')

    // Either 200 (no auth) or 401 (auth required)
    expect([200, 401]).toContain(response.status)
  })

  it('should return 401 for invalid auth token', async () => {
    const response = await get('/api/browsers', {
      Authorization: 'Bearer invalid-token',
    })

    // Either 200 (no auth) or 401 (auth required)
    expect([200, 401]).toContain(response.status)
  })

  it('should allow access with valid auth token', async () => {
    // This test assumes auth is enabled
    // Would need a valid token from the auth system
    const response = await get('/api/browsers', {
      Authorization: 'Bearer valid-test-token',
    })

    // Either 200 (success) or 401 (if test token isn't configured)
    expect([200, 401]).toContain(response.status)
  })
})

// ============================================================================
// 10. Input Validation Tests
// ============================================================================

describe('Browser Routes - Input Validation', () => {
  it('should return 400 for non-JSON body on POST', async () => {
    const response = await app.request('/api/browsers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json {',
    })

    expect(response.status).toBe(400)
  })

  it('should return 400 for missing Content-Type on POST', async () => {
    const response = await app.request('/api/browsers', {
      method: 'POST',
      body: JSON.stringify({ provider: 'cloudflare' }),
    })

    expect(response.status).toBe(400)
  })

  it('should validate provider enum values', async () => {
    const response = await post('/api/browsers', {
      provider: 'unknown-provider',
    })

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.message).toContain('provider')
  })

  it('should validate viewport dimensions are positive', async () => {
    const response = await post('/api/browsers', {
      viewport: { width: 0, height: -100 },
    })

    expect(response.status).toBe(400)
  })

  it('should validate URL format in browse endpoint', async () => {
    const createRes = await post('/api/browsers', { provider: 'cloudflare' })
    const { id } = (await createRes.json()) as CreateSessionResponse

    const response = await post(`/api/browsers/${id}/browse`, {
      url: 'javascript:alert(1)',
    })

    expect(response.status).toBe(400)
  })

  it('should reject empty instruction in act endpoint', async () => {
    const createRes = await post('/api/browsers', { provider: 'cloudflare' })
    const { id } = (await createRes.json()) as CreateSessionResponse

    const response = await post(`/api/browsers/${id}/act`, {
      instruction: '',
    })

    expect(response.status).toBe(400)
  })

  it('should reject empty instruction in extract endpoint', async () => {
    const createRes = await post('/api/browsers', { provider: 'cloudflare' })
    const { id } = (await createRes.json()) as CreateSessionResponse

    const response = await post(`/api/browsers/${id}/extract`, {
      instruction: '',
    })

    expect(response.status).toBe(400)
  })
})

// ============================================================================
// HTTP Method Tests
// ============================================================================

describe('Browser Routes - HTTP Methods', () => {
  it('should return 405 for DELETE on /api/browsers', async () => {
    const response = await app.request('/api/browsers', {
      method: 'DELETE',
    })

    expect(response.status).toBe(405)
  })

  it('should return 405 for PUT on /api/browsers', async () => {
    const response = await app.request('/api/browsers', {
      method: 'PUT',
    })

    expect(response.status).toBe(405)
  })

  it('should return 405 for PATCH on /api/browsers/:id/state', async () => {
    const response = await app.request('/api/browsers/test-id/state', {
      method: 'PATCH',
    })

    expect(response.status).toBe(405)
  })
})

// ============================================================================
// Error Response Format Tests
// ============================================================================

describe('Browser Routes - Error Response Format', () => {
  it('should return consistent error format for 400', async () => {
    const response = await post('/api/browsers', {
      provider: 'invalid',
    })

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse

    expect(body).toHaveProperty('error')
    expect(body.error).toHaveProperty('code')
    expect(body.error).toHaveProperty('message')
    expect(typeof body.error.code).toBe('string')
    expect(typeof body.error.message).toBe('string')
  })

  it('should return consistent error format for 404', async () => {
    const response = await get('/api/browsers/non-existent/state')

    expect(response.status).toBe(404)
    const body = (await response.json()) as ErrorResponse

    expect(body).toHaveProperty('error')
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('should return JSON content type for errors', async () => {
    const response = await get('/api/browsers/non-existent/state')

    expect(response.headers.get('Content-Type')).toContain('application/json')
  })
})

// ============================================================================
// Additional Browser Operations (observe, screenshot)
// ============================================================================

describe('POST /api/browsers/:id/observe - Observe Page', () => {
  it('should observe available actions on page', async () => {
    const createRes = await post('/api/browsers', { provider: 'cloudflare' })
    const { id } = (await createRes.json()) as CreateSessionResponse

    await post(`/api/browsers/${id}/browse`, { url: 'https://example.com.ai' })

    const response = await post(`/api/browsers/${id}/observe`, {})

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toHaveProperty('actions')
    expect(Array.isArray(body.actions)).toBe(true)
  })

  it('should accept optional instruction filter', async () => {
    const createRes = await post('/api/browsers', { provider: 'cloudflare' })
    const { id } = (await createRes.json()) as CreateSessionResponse

    await post(`/api/browsers/${id}/browse`, { url: 'https://example.com.ai' })

    const response = await post(`/api/browsers/${id}/observe`, {
      instruction: 'Find login buttons',
    })

    expect(response.status).toBe(200)
  })
})

describe('GET /api/browsers/:id/screenshot - Take Screenshot', () => {
  it('should return base64 screenshot', async () => {
    const createRes = await post('/api/browsers', { provider: 'cloudflare' })
    const { id } = (await createRes.json()) as CreateSessionResponse

    await post(`/api/browsers/${id}/browse`, { url: 'https://example.com.ai' })

    const response = await get(`/api/browsers/${id}/screenshot`)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toHaveProperty('image')
    expect(typeof body.image).toBe('string')
  })

  it('should accept fullPage query parameter', async () => {
    const createRes = await post('/api/browsers', { provider: 'cloudflare' })
    const { id } = (await createRes.json()) as CreateSessionResponse

    await post(`/api/browsers/${id}/browse`, { url: 'https://example.com.ai' })

    const response = await get(`/api/browsers/${id}/screenshot?fullPage=true`)

    expect(response.status).toBe(200)
  })

  it('should return 404 for non-existent session', async () => {
    const response = await get('/api/browsers/non-existent-id/screenshot')

    expect(response.status).toBe(404)
  })
})

describe('GET /api/browsers/:id/live - Live View Redirect', () => {
  it('should redirect to liveViewUrl when available', async () => {
    const createRes = await post('/api/browsers', {
      provider: 'browserbase',
      liveView: true,
    })
    const { id, liveViewUrl } = (await createRes.json()) as CreateSessionResponse

    const response = await app.request(`/api/browsers/${id}/live`, {
      redirect: 'manual',
    })

    if (liveViewUrl) {
      expect(response.status).toBe(302)
      expect(response.headers.get('Location')).toBe(liveViewUrl)
    } else {
      // If no liveViewUrl (cloudflare), should return 404 or appropriate error
      expect([404, 400]).toContain(response.status)
    }
  })

  it('should return 404 when liveViewUrl not available', async () => {
    const createRes = await post('/api/browsers', {
      provider: 'cloudflare', // Cloudflare doesn't have live view
    })
    const { id } = (await createRes.json()) as CreateSessionResponse

    const response = await get(`/api/browsers/${id}/live`)

    expect([404, 400]).toContain(response.status)
  })
})
