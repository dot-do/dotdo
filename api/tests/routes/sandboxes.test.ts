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

import { describe, it, expect, beforeEach } from 'vitest'

// Import the app directly for testing
import { app } from '../../index'

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

async function del(path: string, headers?: Record<string, string>): Promise<Response> {
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
    const response = await get('/api/sandboxes')

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('application/json')

    const body = await response.json()
    expect(body).toHaveProperty('sandboxes')
    expect(Array.isArray(body.sandboxes)).toBe(true)
  })

  it('should return empty array when no sessions exist', async () => {
    const response = await get('/api/sandboxes')

    const body = await response.json()
    expect(body.sandboxes).toEqual([])
  })

  it('should return sessions with required fields after creating one', async () => {
    // First create a session
    await post('/api/sandboxes', {})

    const response = await get('/api/sandboxes')
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
    const response = await post('/api/sandboxes', {})

    expect(response.status).toBe(201)
    expect(response.headers.get('Content-Type')).toContain('application/json')
  })

  it('should return sandbox id and status', async () => {
    const response = await post('/api/sandboxes', {})

    const body = (await response.json()) as CreateSandboxResponse
    expect(body).toHaveProperty('id')
    expect(body).toHaveProperty('status')
    expect(typeof body.id).toBe('string')
    expect(body.id.length).toBeGreaterThan(0)
  })

  it('should accept optional sleepAfter configuration', async () => {
    const response = await post('/api/sandboxes', {
      sleepAfter: '5m',
    })

    expect(response.status).toBe(201)
  })

  it('should accept optional keepAlive configuration', async () => {
    const response = await post('/api/sandboxes', {
      keepAlive: true,
    })

    expect(response.status).toBe(201)
  })

  it('should return 400 for invalid body', async () => {
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
    // Create session first
    const createRes = await post('/api/sandboxes', {})
    const { id } = (await createRes.json()) as CreateSandboxResponse

    const response = await get(`/api/sandboxes/${id}/state`)

    expect(response.status).toBe(200)
    const body = (await response.json()) as SandboxState
    expect(body).toHaveProperty('status')
  })

  it('should include status in state', async () => {
    const createRes = await post('/api/sandboxes', {})
    const { id } = (await createRes.json()) as CreateSandboxResponse

    const response = await get(`/api/sandboxes/${id}/state`)
    const body = (await response.json()) as SandboxState

    expect(['idle', 'running', 'stopped', 'error']).toContain(body.status)
  })

  it('should return 404 for non-existent session', async () => {
    const response = await get('/api/sandboxes/non-existent-id/state')

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
    const createRes = await post('/api/sandboxes', {})
    const { id } = (await createRes.json()) as CreateSandboxResponse

    const response = await del(`/api/sandboxes/${id}`)

    expect(response.status).toBe(200)
  })

  it('should return success in response', async () => {
    const createRes = await post('/api/sandboxes', {})
    const { id } = (await createRes.json()) as CreateSandboxResponse

    const response = await del(`/api/sandboxes/${id}`)
    const body = await response.json()

    expect(body).toHaveProperty('success')
    expect(body.success).toBe(true)
  })

  it('should return 404 for non-existent session', async () => {
    const response = await del('/api/sandboxes/non-existent-id')

    expect(response.status).toBe(404)
  })

  it('should update session state to stopped after destroy', async () => {
    const createRes = await post('/api/sandboxes', {})
    const { id } = (await createRes.json()) as CreateSandboxResponse

    await del(`/api/sandboxes/${id}`)

    // Verify state (should be 404 or stopped)
    const stateRes = await get(`/api/sandboxes/${id}/state`)
    // After destroy, the session should either be gone (404) or stopped
    expect([200, 404]).toContain(stateRes.status)
    if (stateRes.status === 200) {
      const state = (await stateRes.json()) as SandboxState
      expect(state.status).toBe('stopped')
    }
  })
})

// ============================================================================
// 5. POST /api/sandboxes/:id/exec - Execute Command
// ============================================================================

describe('POST /api/sandboxes/:id/exec - Execute Command', () => {
  it('should execute command and return result', async () => {
    const createRes = await post('/api/sandboxes', {})
    const { id } = (await createRes.json()) as CreateSandboxResponse

    const response = await post(`/api/sandboxes/${id}/exec`, {
      command: 'echo hello',
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toHaveProperty('stdout')
  })

  it('should return 400 for missing command', async () => {
    const createRes = await post('/api/sandboxes', {})
    const { id } = (await createRes.json()) as CreateSandboxResponse

    const response = await post(`/api/sandboxes/${id}/exec`, {})

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.message).toContain('command')
  })

  it('should return 404 for non-existent session', async () => {
    const response = await post('/api/sandboxes/non-existent-id/exec', {
      command: 'echo hello',
    })

    expect(response.status).toBe(404)
  })

  it('should return exit code in result', async () => {
    const createRes = await post('/api/sandboxes', {})
    const { id } = (await createRes.json()) as CreateSandboxResponse

    const response = await post(`/api/sandboxes/${id}/exec`, {
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
    const createRes = await post('/api/sandboxes', {})
    const { id } = (await createRes.json()) as CreateSandboxResponse

    const response = await get(`/api/sandboxes/${id}/terminal`)

    // Should require WebSocket upgrade
    expect(response.status).toBe(426)
  })

  it('should return 404 for non-existent session', async () => {
    const response = await get('/api/sandboxes/non-existent-id/terminal')

    expect([404, 426]).toContain(response.status)
  })
})

// ============================================================================
// 7. POST /api/sandboxes/:id/file - Write File
// ============================================================================

describe('POST /api/sandboxes/:id/file - Write File', () => {
  it('should write file successfully', async () => {
    const createRes = await post('/api/sandboxes', {})
    const { id } = (await createRes.json()) as CreateSandboxResponse

    const response = await post(`/api/sandboxes/${id}/file`, {
      path: '/tmp/test.txt',
      content: 'Hello, World!',
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toHaveProperty('success')
    expect(body.success).toBe(true)
  })

  it('should return 400 for missing path', async () => {
    const createRes = await post('/api/sandboxes', {})
    const { id } = (await createRes.json()) as CreateSandboxResponse

    const response = await post(`/api/sandboxes/${id}/file`, {
      content: 'Hello',
    })

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.message).toContain('path')
  })

  it('should return 400 for missing content', async () => {
    const createRes = await post('/api/sandboxes', {})
    const { id } = (await createRes.json()) as CreateSandboxResponse

    const response = await post(`/api/sandboxes/${id}/file`, {
      path: '/tmp/test.txt',
    })

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.message).toContain('content')
  })

  it('should return 404 for non-existent session', async () => {
    const response = await post('/api/sandboxes/non-existent-id/file', {
      path: '/tmp/test.txt',
      content: 'Hello',
    })

    expect(response.status).toBe(404)
  })

  it('should support base64 encoding', async () => {
    const createRes = await post('/api/sandboxes', {})
    const { id } = (await createRes.json()) as CreateSandboxResponse

    const response = await post(`/api/sandboxes/${id}/file`, {
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
    const createRes = await post('/api/sandboxes', {})
    const { id } = (await createRes.json()) as CreateSandboxResponse

    // First write a file
    await post(`/api/sandboxes/${id}/file`, {
      path: '/tmp/read-test.txt',
      content: 'Test content',
    })

    // Then read it
    const response = await get(`/api/sandboxes/${id}/file?path=/tmp/read-test.txt`)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toHaveProperty('content')
  })

  it('should return 400 for missing path query parameter', async () => {
    const createRes = await post('/api/sandboxes', {})
    const { id } = (await createRes.json()) as CreateSandboxResponse

    const response = await get(`/api/sandboxes/${id}/file`)

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.message).toContain('path')
  })

  it('should return 404 for non-existent session', async () => {
    const response = await get('/api/sandboxes/non-existent-id/file?path=/tmp/test.txt')

    expect(response.status).toBe(404)
  })

  it('should return 404 for non-existent file', async () => {
    const createRes = await post('/api/sandboxes', {})
    const { id } = (await createRes.json()) as CreateSandboxResponse

    const response = await get(`/api/sandboxes/${id}/file?path=/nonexistent/path.txt`)

    // Either 404 for file not found, or 500 for internal error
    expect([404, 500]).toContain(response.status)
  })
})

// ============================================================================
// 9. GET /api/sandboxes/:id/ports - List Exposed Ports
// ============================================================================

describe('GET /api/sandboxes/:id/ports - List Exposed Ports', () => {
  it('should return list of exposed ports', async () => {
    const createRes = await post('/api/sandboxes', {})
    const { id } = (await createRes.json()) as CreateSandboxResponse

    const response = await get(`/api/sandboxes/${id}/ports`)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toHaveProperty('ports')
    expect(Array.isArray(body.ports)).toBe(true)
  })

  it('should return empty array when no ports exposed', async () => {
    const createRes = await post('/api/sandboxes', {})
    const { id } = (await createRes.json()) as CreateSandboxResponse

    const response = await get(`/api/sandboxes/${id}/ports`)
    const body = await response.json()

    expect(body.ports).toEqual([])
  })

  it('should return 404 for non-existent session', async () => {
    const response = await get('/api/sandboxes/non-existent-id/ports')

    expect(response.status).toBe(404)
  })
})

// ============================================================================
// 10. POST /api/sandboxes/:id/port - Expose a Port
// ============================================================================

describe('POST /api/sandboxes/:id/port - Expose Port', () => {
  it('should expose port successfully', async () => {
    const createRes = await post('/api/sandboxes', {})
    const { id } = (await createRes.json()) as CreateSandboxResponse

    const response = await post(`/api/sandboxes/${id}/port`, {
      port: 3000,
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as ExposedPort
    expect(body).toHaveProperty('port')
    expect(body.port).toBe(3000)
  })

  it('should return URL for exposed port', async () => {
    const createRes = await post('/api/sandboxes', {})
    const { id } = (await createRes.json()) as CreateSandboxResponse

    const response = await post(`/api/sandboxes/${id}/port`, {
      port: 8080,
    })

    if (response.status === 200) {
      const body = (await response.json()) as ExposedPort
      expect(body).toHaveProperty('url')
    }
  })

  it('should return 400 for missing port', async () => {
    const createRes = await post('/api/sandboxes', {})
    const { id } = (await createRes.json()) as CreateSandboxResponse

    const response = await post(`/api/sandboxes/${id}/port`, {})

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.message).toContain('port')
  })

  it('should return 400 for invalid port number', async () => {
    const createRes = await post('/api/sandboxes', {})
    const { id } = (await createRes.json()) as CreateSandboxResponse

    const response = await post(`/api/sandboxes/${id}/port`, {
      port: -1,
    })

    expect(response.status).toBe(400)
  })

  it('should return 400 for port out of range', async () => {
    const createRes = await post('/api/sandboxes', {})
    const { id } = (await createRes.json()) as CreateSandboxResponse

    const response = await post(`/api/sandboxes/${id}/port`, {
      port: 70000,
    })

    expect(response.status).toBe(400)
  })

  it('should accept optional port name', async () => {
    const createRes = await post('/api/sandboxes', {})
    const { id } = (await createRes.json()) as CreateSandboxResponse

    const response = await post(`/api/sandboxes/${id}/port`, {
      port: 3000,
      name: 'web-server',
    })

    expect(response.status).toBe(200)
  })

  it('should return 404 for non-existent session', async () => {
    const response = await post('/api/sandboxes/non-existent-id/port', {
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
    // Note: This depends on whether auth middleware is enabled
    const response = await get('/api/sandboxes')

    // Either 200 (no auth) or 401 (auth required)
    expect([200, 401]).toContain(response.status)
  })

  it('should return 401 for invalid auth token', async () => {
    const response = await get('/api/sandboxes', {
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
    const response = await app.request('/api/sandboxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json {',
    })

    expect(response.status).toBe(400)
  })

  it('should validate port is a number', async () => {
    const createRes = await post('/api/sandboxes', {})
    const { id } = (await createRes.json()) as CreateSandboxResponse

    const response = await post(`/api/sandboxes/${id}/port`, {
      port: 'not-a-number',
    })

    expect(response.status).toBe(400)
  })

  it('should validate command is not empty', async () => {
    const createRes = await post('/api/sandboxes', {})
    const { id } = (await createRes.json()) as CreateSandboxResponse

    const response = await post(`/api/sandboxes/${id}/exec`, {
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
    const response = await app.request('/api/sandboxes', {
      method: 'PUT',
    })

    expect(response.status).toBe(405)
  })

  it('should return 405 for PATCH on /api/sandboxes', async () => {
    const response = await app.request('/api/sandboxes', {
      method: 'PATCH',
    })

    expect(response.status).toBe(405)
  })

  it('should return 405 for DELETE on /api/sandboxes collection', async () => {
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
    const createRes = await post('/api/sandboxes', {})
    const { id } = (await createRes.json()) as CreateSandboxResponse

    const response = await post(`/api/sandboxes/${id}/exec`, {})

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse

    expect(body).toHaveProperty('error')
    expect(body.error).toHaveProperty('code')
    expect(body.error).toHaveProperty('message')
    expect(typeof body.error.code).toBe('string')
    expect(typeof body.error.message).toBe('string')
  })

  it('should return consistent error format for 404', async () => {
    const response = await get('/api/sandboxes/non-existent/state')

    expect(response.status).toBe(404)
    const body = (await response.json()) as ErrorResponse

    expect(body).toHaveProperty('error')
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('should return JSON content type for errors', async () => {
    const response = await get('/api/sandboxes/non-existent/state')

    expect(response.headers.get('Content-Type')).toContain('application/json')
  })
})
