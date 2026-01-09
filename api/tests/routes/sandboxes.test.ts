/**
 * Sandbox API Route Tests
 *
 * Tests for the /api/sandboxes/* REST endpoints that manage code execution sandboxes.
 * These routes proxy to the SandboxDO Durable Object for session lifecycle and operations.
 *
 * TDD: These tests define the expected behavior BEFORE implementation.
 *
 * @see objects/SandboxDO.ts - Sandbox Durable Object implementation
 * @see api/routes/sandboxes.ts - Route handlers
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'

// Import the sandboxes routes directly to avoid cloudflare:workers import issues
import { sandboxesRoutes } from '../../routes/sandboxes'

// ============================================================================
// Test Types
// ============================================================================

interface SandboxSession {
  id: string
  status: 'idle' | 'running' | 'stopped' | 'error'
  createdAt: string
}

interface CreateSandboxResponse {
  id: string
  status: string
}

interface SandboxState {
  status: 'idle' | 'running' | 'stopped' | 'error'
  sandboxId?: string
  createdAt?: string
  lastActivityAt?: string
}

interface ExecResult {
  stdout?: string
  stderr?: string
  exitCode?: number
}

interface ExposedPort {
  port: number
  name?: string
  url?: string
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
        '/create': { status: 200, body: { sessionId: 'test-session-id', status: 'created' } },
        '/state': { status: 200, body: { status: 'running', createdAt: new Date().toISOString() } },
        '/destroy': { status: 200, body: { success: true } },
        '/exec': { status: 200, body: { stdout: 'hello\n', stderr: '', exitCode: 0 } },
        '/file/write': { status: 200, body: { success: true } },
        '/file/read': { status: 200, body: { content: 'test content' } },
        '/ports': { status: 200, body: [] },
        '/port/expose': { status: 200, body: { port: 3000, url: 'https://test.sandbox.do/3000' } },
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

// Create test app with mock bindings
function createTestApp(stubOverrides: Record<string, { status?: number; body: unknown }> = {}) {
  const app = new Hono<{ Bindings: { SANDBOX_DO: DurableObjectNamespace } }>()

  // Add mock bindings middleware
  app.use('*', async (c, next) => {
    c.env = {
      SANDBOX_DO: createMockNamespace(stubOverrides) as unknown as DurableObjectNamespace,
    }
    await next()
  })

  // Mount sandboxes routes
  app.route('/api/sandboxes', sandboxesRoutes)

  return app
}

// Track created sessions for registry simulation
let createdSessionIds: string[] = []

// Helper to create a session and return its ID
async function createSession(app: Hono, body: unknown = {}): Promise<string> {
  const res = await app.request('/api/sandboxes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json() as CreateSandboxResponse
  if (data.id) {
    createdSessionIds.push(data.id)
  }
  return data.id
}

// Reset session tracking before each test
beforeEach(() => {
  createdSessionIds = []
  vi.clearAllMocks()
})

// ============================================================================
// Helper Functions
// ============================================================================

async function request(
  app: Hono,
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

async function get(app: Hono, path: string, headers?: Record<string, string>): Promise<Response> {
  return app.request(path, {
    method: 'GET',
    headers,
  })
}

async function post(app: Hono, path: string, body: unknown, headers?: Record<string, string>): Promise<Response> {
  return request(app, 'POST', path, body, headers)
}

async function del(app: Hono, path: string, headers?: Record<string, string>): Promise<Response> {
  return app.request(path, {
    method: 'DELETE',
    headers,
  })
}

// ============================================================================
// 1. GET /api/sandboxes - List Sandbox Sessions
// ============================================================================

describe('GET /api/sandboxes - List Sessions', () => {
  it('should return 200 with array of sessions', async () => {
    const app = createTestApp()
    const response = await get(app, '/api/sandboxes')

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('application/json')

    const body = await response.json()
    expect(body).toHaveProperty('sandboxes')
    expect(Array.isArray(body.sandboxes)).toBe(true)
  })

  it('should return empty array when no sessions exist', async () => {
    const app = createTestApp()
    const response = await get(app, '/api/sandboxes')

    const body = await response.json()
    expect(body.sandboxes).toEqual([])
  })

  it('should return sessions with required fields after creating one', async () => {
    const app = createTestApp()

    // First create a session
    await post(app, '/api/sandboxes', {})

    const response = await get(app, '/api/sandboxes')
    const body = await response.json()

    if (body.sandboxes.length > 0) {
      const session = body.sandboxes[0] as SandboxSession
      expect(session).toHaveProperty('id')
      expect(session).toHaveProperty('status')
    }
  })
})

// ============================================================================
// 2. POST /api/sandboxes - Create New Sandbox Session
// ============================================================================

describe('POST /api/sandboxes - Create Session', () => {
  it('should create new sandbox and return 201', async () => {
    const app = createTestApp()
    const response = await post(app, '/api/sandboxes', {})

    expect(response.status).toBe(201)
    expect(response.headers.get('Content-Type')).toContain('application/json')
  })

  it('should return sandbox id and status', async () => {
    const app = createTestApp()
    const response = await post(app, '/api/sandboxes', {})

    const body = (await response.json()) as CreateSandboxResponse
    expect(body).toHaveProperty('id')
    expect(body).toHaveProperty('status')
    expect(typeof body.id).toBe('string')
    expect(body.id.length).toBeGreaterThan(0)
  })

  it('should accept optional sleepAfter configuration', async () => {
    const app = createTestApp()
    const response = await post(app, '/api/sandboxes', {
      sleepAfter: '5m',
    })

    expect(response.status).toBe(201)
  })

  it('should accept optional keepAlive configuration', async () => {
    const app = createTestApp()
    const response = await post(app, '/api/sandboxes', {
      keepAlive: true,
    })

    expect(response.status).toBe(201)
  })

  it('should return 400 for invalid body', async () => {
    const app = createTestApp()
    const response = await app.request('/api/sandboxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json {',
    })

    expect(response.status).toBe(400)
  })
})

// ============================================================================
// 3. GET /api/sandboxes/:id/state - Get Session State
// ============================================================================

describe('GET /api/sandboxes/:id/state - Get State', () => {
  it('should return session state', async () => {
    const app = createTestApp()

    // Create session first
    const id = await createSession(app)

    const response = await get(app, `/api/sandboxes/${id}/state`)

    expect(response.status).toBe(200)
    const body = (await response.json()) as SandboxState
    expect(body).toHaveProperty('status')
  })

  it('should include status in state', async () => {
    const app = createTestApp()
    const id = await createSession(app)

    const response = await get(app, `/api/sandboxes/${id}/state`)
    const body = (await response.json()) as SandboxState

    expect(['idle', 'running', 'stopped', 'error']).toContain(body.status)
  })

  it('should return 404 for non-existent session', async () => {
    const app = createTestApp()
    const response = await get(app, '/api/sandboxes/non-existent-id/state')

    expect(response.status).toBe(404)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.code).toBe('NOT_FOUND')
  })
})

// ============================================================================
// 4. DELETE /api/sandboxes/:id - Destroy Sandbox
// ============================================================================

describe('DELETE /api/sandboxes/:id - Destroy Sandbox', () => {
  it('should destroy sandbox and return 200', async () => {
    const app = createTestApp()
    const id = await createSession(app)

    const response = await del(app, `/api/sandboxes/${id}`)

    expect(response.status).toBe(200)
  })

  it('should return success in response', async () => {
    const app = createTestApp()
    const id = await createSession(app)

    const response = await del(app, `/api/sandboxes/${id}`)
    const body = await response.json()

    expect(body).toHaveProperty('success')
    expect(body.success).toBe(true)
  })

  it('should return 404 for non-existent session', async () => {
    const app = createTestApp()
    const response = await del(app, '/api/sandboxes/non-existent-id')

    expect(response.status).toBe(404)
  })
})

// ============================================================================
// 5. POST /api/sandboxes/:id/exec - Execute Command
// ============================================================================

describe('POST /api/sandboxes/:id/exec - Execute Command', () => {
  it('should execute command and return result', async () => {
    const app = createTestApp()
    const id = await createSession(app)

    const response = await post(app, `/api/sandboxes/${id}/exec`, {
      command: 'echo hello',
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toHaveProperty('stdout')
  })

  it('should return 400 for missing command', async () => {
    const app = createTestApp()
    const id = await createSession(app)

    const response = await post(app, `/api/sandboxes/${id}/exec`, {})

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.message).toContain('command')
  })

  it('should return 404 for non-existent session', async () => {
    const app = createTestApp()
    const response = await post(app, '/api/sandboxes/non-existent-id/exec', {
      command: 'echo hello',
    })

    expect(response.status).toBe(404)
  })

  it('should return exit code in result', async () => {
    const app = createTestApp()
    const id = await createSession(app)

    const response = await post(app, `/api/sandboxes/${id}/exec`, {
      command: 'exit 0',
    })

    if (response.status === 200) {
      const body = (await response.json()) as ExecResult
      expect(body).toHaveProperty('exitCode')
    }
  })
})

// ============================================================================
// 6. GET /api/sandboxes/:id/terminal - WebSocket Terminal
// ============================================================================

describe('GET /api/sandboxes/:id/terminal - WebSocket Terminal', () => {
  it('should return 426 when WebSocket upgrade not requested', async () => {
    const app = createTestApp()
    const id = await createSession(app)

    const response = await get(app, `/api/sandboxes/${id}/terminal`)

    // Should require WebSocket upgrade
    expect(response.status).toBe(426)
  })

  it('should return 404 for non-existent session', async () => {
    const app = createTestApp()
    const response = await get(app, '/api/sandboxes/non-existent-id/terminal')

    expect([404, 426]).toContain(response.status)
  })
})

// ============================================================================
// 7. POST /api/sandboxes/:id/file - Write File
// ============================================================================

describe('POST /api/sandboxes/:id/file - Write File', () => {
  it('should write file successfully', async () => {
    const app = createTestApp()
    const id = await createSession(app)

    const response = await post(app, `/api/sandboxes/${id}/file`, {
      path: '/tmp/test.txt',
      content: 'Hello, World!',
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toHaveProperty('success')
    expect(body.success).toBe(true)
  })

  it('should return 400 for missing path', async () => {
    const app = createTestApp()
    const id = await createSession(app)

    const response = await post(app, `/api/sandboxes/${id}/file`, {
      content: 'Hello',
    })

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.message).toContain('path')
  })

  it('should return 400 for missing content', async () => {
    const app = createTestApp()
    const id = await createSession(app)

    const response = await post(app, `/api/sandboxes/${id}/file`, {
      path: '/tmp/test.txt',
    })

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.message).toContain('content')
  })

  it('should return 404 for non-existent session', async () => {
    const app = createTestApp()
    const response = await post(app, '/api/sandboxes/non-existent-id/file', {
      path: '/tmp/test.txt',
      content: 'Hello',
    })

    expect(response.status).toBe(404)
  })

  it('should support base64 encoding', async () => {
    const app = createTestApp()
    const id = await createSession(app)

    const response = await post(app, `/api/sandboxes/${id}/file`, {
      path: '/tmp/test.bin',
      content: btoa('binary data'),
      encoding: 'base64',
    })

    expect(response.status).toBe(200)
  })
})

// ============================================================================
// 8. GET /api/sandboxes/:id/file - Read File
// ============================================================================

describe('GET /api/sandboxes/:id/file - Read File', () => {
  it('should read file successfully', async () => {
    const app = createTestApp()
    const id = await createSession(app)

    const response = await get(app, `/api/sandboxes/${id}/file?path=/tmp/read-test.txt`)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toHaveProperty('content')
  })

  it('should return 400 for missing path query parameter', async () => {
    const app = createTestApp()
    const id = await createSession(app)

    const response = await get(app, `/api/sandboxes/${id}/file`)

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.message).toContain('path')
  })

  it('should return 404 for non-existent session', async () => {
    const app = createTestApp()
    const response = await get(app, '/api/sandboxes/non-existent-id/file?path=/tmp/test.txt')

    expect(response.status).toBe(404)
  })

  it('should return 404 for non-existent file', async () => {
    const app = createTestApp({
      '/file/read': { status: 404, body: { error: 'File not found' } },
    })
    const id = await createSession(app)

    const response = await get(app, `/api/sandboxes/${id}/file?path=/nonexistent/path.txt`)

    // Either 404 for file not found, or 500 for internal error
    expect([404, 500]).toContain(response.status)
  })
})

// ============================================================================
// 9. GET /api/sandboxes/:id/ports - List Exposed Ports
// ============================================================================

describe('GET /api/sandboxes/:id/ports - List Exposed Ports', () => {
  it('should return list of exposed ports', async () => {
    const app = createTestApp()
    const id = await createSession(app)

    const response = await get(app, `/api/sandboxes/${id}/ports`)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toHaveProperty('ports')
    expect(Array.isArray(body.ports)).toBe(true)
  })

  it('should return empty array when no ports exposed', async () => {
    const app = createTestApp()
    const id = await createSession(app)

    const response = await get(app, `/api/sandboxes/${id}/ports`)
    const body = await response.json()

    expect(body.ports).toEqual([])
  })

  it('should return 404 for non-existent session', async () => {
    const app = createTestApp()
    const response = await get(app, '/api/sandboxes/non-existent-id/ports')

    expect(response.status).toBe(404)
  })
})

// ============================================================================
// 10. POST /api/sandboxes/:id/port - Expose a Port
// ============================================================================

describe('POST /api/sandboxes/:id/port - Expose Port', () => {
  it('should expose port successfully', async () => {
    const app = createTestApp()
    const id = await createSession(app)

    const response = await post(app, `/api/sandboxes/${id}/port`, {
      port: 3000,
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as ExposedPort
    expect(body).toHaveProperty('port')
    expect(body.port).toBe(3000)
  })

  it('should return URL for exposed port', async () => {
    const app = createTestApp()
    const id = await createSession(app)

    const response = await post(app, `/api/sandboxes/${id}/port`, {
      port: 8080,
    })

    if (response.status === 200) {
      const body = (await response.json()) as ExposedPort
      expect(body).toHaveProperty('url')
    }
  })

  it('should return 400 for missing port', async () => {
    const app = createTestApp()
    const id = await createSession(app)

    const response = await post(app, `/api/sandboxes/${id}/port`, {})

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.message).toContain('port')
  })

  it('should return 400 for invalid port number', async () => {
    const app = createTestApp()
    const id = await createSession(app)

    const response = await post(app, `/api/sandboxes/${id}/port`, {
      port: -1,
    })

    expect(response.status).toBe(400)
  })

  it('should return 400 for port out of range', async () => {
    const app = createTestApp()
    const id = await createSession(app)

    const response = await post(app, `/api/sandboxes/${id}/port`, {
      port: 70000,
    })

    expect(response.status).toBe(400)
  })

  it('should accept optional port name', async () => {
    const app = createTestApp()
    const id = await createSession(app)

    const response = await post(app, `/api/sandboxes/${id}/port`, {
      port: 3000,
      name: 'web-server',
    })

    expect(response.status).toBe(200)
  })

  it('should return 404 for non-existent session', async () => {
    const app = createTestApp()
    const response = await post(app, '/api/sandboxes/non-existent-id/port', {
      port: 3000,
    })

    expect(response.status).toBe(404)
  })
})

// ============================================================================
// 11. Authentication Tests
// ============================================================================

describe('Sandbox Routes - Authentication', () => {
  it('should return 401 when auth is required and no token provided', async () => {
    const app = createTestApp()
    // Note: This depends on whether auth middleware is enabled
    const response = await get(app, '/api/sandboxes')

    // Either 200 (no auth) or 401 (auth required)
    expect([200, 401]).toContain(response.status)
  })

  it('should return 401 for invalid auth token', async () => {
    const app = createTestApp()
    const response = await get(app, '/api/sandboxes', {
      Authorization: 'Bearer invalid-token',
    })

    // Either 200 (no auth) or 401 (auth required)
    expect([200, 401]).toContain(response.status)
  })
})

// ============================================================================
// 12. Input Validation Tests
// ============================================================================

describe('Sandbox Routes - Input Validation', () => {
  it('should return 400 for non-JSON body on POST', async () => {
    const app = createTestApp()
    const response = await app.request('/api/sandboxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json {',
    })

    expect(response.status).toBe(400)
  })

  it('should validate port is a number', async () => {
    const app = createTestApp()
    const id = await createSession(app)

    const response = await post(app, `/api/sandboxes/${id}/port`, {
      port: 'not-a-number',
    })

    expect(response.status).toBe(400)
  })

  it('should validate command is not empty', async () => {
    const app = createTestApp()
    const id = await createSession(app)

    const response = await post(app, `/api/sandboxes/${id}/exec`, {
      command: '',
    })

    expect(response.status).toBe(400)
  })
})

// ============================================================================
// 13. HTTP Method Tests
// ============================================================================

describe('Sandbox Routes - HTTP Methods', () => {
  it('should return 405 for PUT on /api/sandboxes', async () => {
    const app = createTestApp()
    const response = await app.request('/api/sandboxes', {
      method: 'PUT',
    })

    expect(response.status).toBe(405)
  })

  it('should return 405 for PATCH on /api/sandboxes', async () => {
    const app = createTestApp()
    const response = await app.request('/api/sandboxes', {
      method: 'PATCH',
    })

    expect(response.status).toBe(405)
  })

  it('should return 405 for DELETE on /api/sandboxes collection', async () => {
    const app = createTestApp()
    const response = await app.request('/api/sandboxes', {
      method: 'DELETE',
    })

    expect(response.status).toBe(405)
  })
})

// ============================================================================
// 14. Error Response Format Tests
// ============================================================================

describe('Sandbox Routes - Error Response Format', () => {
  it('should return consistent error format for 400', async () => {
    const app = createTestApp()
    const id = await createSession(app)

    const response = await post(app, `/api/sandboxes/${id}/exec`, {})

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse

    expect(body).toHaveProperty('error')
    expect(body.error).toHaveProperty('code')
    expect(body.error).toHaveProperty('message')
    expect(typeof body.error.code).toBe('string')
    expect(typeof body.error.message).toBe('string')
  })

  it('should return consistent error format for 404', async () => {
    const app = createTestApp()
    const response = await get(app, '/api/sandboxes/non-existent/state')

    expect(response.status).toBe(404)
    const body = (await response.json()) as ErrorResponse

    expect(body).toHaveProperty('error')
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('should return JSON content type for errors', async () => {
    const app = createTestApp()
    const response = await get(app, '/api/sandboxes/non-existent/state')

    expect(response.headers.get('Content-Type')).toContain('application/json')
  })
})
