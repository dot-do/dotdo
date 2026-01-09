/**
 * Sandbox DO HTTP Routes Tests
 *
 * RED TDD: Tests for Sandbox Durable Object Hono routes for HTTP API access.
 *
 * These tests verify the HTTP API for the SandboxDO:
 * 1. POST /create - creates sandbox session with options
 * 2. POST /exec - executes command, returns ExecResult
 * 3. POST /exec/stream - returns SSE stream of output
 * 4. POST /file/write - writes file to sandbox (path, content in body)
 * 5. GET /file/read?path=... - reads file from sandbox
 * 6. POST /port/expose - exposes port for preview URL
 * 7. GET /ports - lists exposed ports
 * 8. GET /state - returns session state (status, exposedPorts, etc)
 * 9. POST /destroy - tears down sandbox
 * 10. GET /terminal - upgrades to WebSocket (delegate to WS handler)
 * 11. Invalid route returns 404
 * 12. Invalid body returns 400 with error message
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ============================================================================
// MOCK SANDBOX SDK
// ============================================================================

/**
 * Mock DotdoSandbox for testing
 */
interface MockSandbox {
  exec: ReturnType<typeof vi.fn>
  execStream: ReturnType<typeof vi.fn>
  writeFile: ReturnType<typeof vi.fn>
  readFile: ReturnType<typeof vi.fn>
  mkdir: ReturnType<typeof vi.fn>
  deleteFile: ReturnType<typeof vi.fn>
  exists: ReturnType<typeof vi.fn>
  exposePort: ReturnType<typeof vi.fn>
  getExposedPorts: ReturnType<typeof vi.fn>
  unexposePort: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  startProcess: ReturnType<typeof vi.fn>
}

/**
 * Create a mock Sandbox
 */
function createMockSandbox(): MockSandbox {
  return {
    exec: vi.fn().mockResolvedValue({
      stdout: 'test output',
      stderr: '',
      exitCode: 0,
      success: true,
    }),
    execStream: vi.fn().mockImplementation(async function* () {
      yield { type: 'stdout', data: 'line 1\n' }
      yield { type: 'stdout', data: 'line 2\n' }
      yield { type: 'complete', exitCode: 0 }
    }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue({ content: 'file contents' }),
    mkdir: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue({ exists: true }),
    exposePort: vi.fn().mockResolvedValue({
      port: 3000,
      exposedAt: 'https://preview.example.com',
    }),
    getExposedPorts: vi.fn().mockResolvedValue([
      { port: 3000, exposedAt: 'https://preview.example.com', name: 'web' },
    ]),
    unexposePort: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    startProcess: vi.fn().mockResolvedValue(undefined),
  }
}

/**
 * Mock getSandbox function
 */
const mockGetSandbox = vi.fn()

vi.mock('../../sandbox', () => ({
  getSandbox: (namespace: unknown, id: string, hostname: string, config?: unknown) =>
    mockGetSandbox(namespace, id, hostname, config),
  DotdoSandbox: vi.fn(),
  Sandbox: vi.fn(),
}))

// ============================================================================
// MOCK DO ENVIRONMENT
// ============================================================================

/**
 * Mock DurableObjectState for testing
 */
function createMockDOState() {
  const storage = new Map<string, unknown>()
  const sqlData: Map<string, unknown[]> = new Map()

  // Initialize tables
  sqlData.set('things', [])
  sqlData.set('branches', [])
  sqlData.set('actions', [])
  sqlData.set('events', [])
  sqlData.set('objects', [])

  let alarm: number | null = null

  return {
    id: {
      toString: () => 'mock-sandbox-do-id-12345',
      name: 'test-sandbox-namespace',
    },
    storage: {
      get: vi.fn(async (key: string) => storage.get(key)),
      put: vi.fn(async (key: string, value: unknown) => {
        storage.set(key, value)
      }),
      delete: vi.fn(async (key: string) => storage.delete(key)),
      list: vi.fn(async () => storage),
      getAlarm: vi.fn(async () => alarm),
      setAlarm: vi.fn(async (time: number | Date) => {
        alarm = typeof time === 'number' ? time : time.getTime()
      }),
      deleteAlarm: vi.fn(async () => {
        alarm = null
      }),
      sql: {
        exec: vi.fn(() => {
          return { results: [] }
        }),
      },
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
    _storage: storage,
    _sqlData: sqlData,
    _getAlarm: () => alarm,
  }
}

/**
 * Mock environment bindings
 */
function createMockEnv() {
  return {
    Sandbox: {
      get: vi.fn(() => ({
        fetch: vi.fn(async () => new Response('OK')),
      })),
      idFromName: vi.fn((name: string) => ({
        toString: () => `id-from-${name}`,
        name,
      })),
    },
    DO: {
      get: vi.fn(() => ({
        fetch: vi.fn(async () => new Response('OK')),
      })),
      idFromName: vi.fn((name: string) => ({
        toString: () => `id-from-${name}`,
        name,
      })),
    },
    PIPELINE: {
      send: vi.fn(async () => {}),
    },
  }
}

// ============================================================================
// SANDBOX DO TYPES
// ============================================================================

interface SandboxCreateOptions {
  sleepAfter?: string
  keepAlive?: boolean
}

interface SandboxCreateResult {
  sessionId: string
  status: 'created'
}

interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
  success: boolean
}

interface ExposedPort {
  port: number
  exposedAt: string
  name?: string
}

interface SandboxState {
  status: 'idle' | 'running' | 'stopped'
  exposedPorts: ExposedPort[]
  createdAt: string
}

// ============================================================================
// IMPORTS
// ============================================================================

// Import the actual SandboxDO class - this will test the real implementation
import { SandboxDO } from '../SandboxDO'

// ============================================================================
// HELPER: Create SandboxDO with mocked internals
// ============================================================================

async function createTestSandboxDO() {
  const mockState = createMockDOState()
  const mockEnv = createMockEnv()
  const sandboxDO = new SandboxDO(
    mockState as unknown as DurableObjectState,
    mockEnv as unknown as any
  )

  // Mock the protected methods to avoid Drizzle DB calls
  const logActionMock = vi.fn(async () => ({ rowid: 1 }))
  const emitMock = vi.fn(async () => {})
  const emitEventMock = vi.fn(async () => {})

  ;(sandboxDO as any).logAction = logActionMock
  ;(sandboxDO as any).emit = emitMock
  ;(sandboxDO as any).emitEvent = emitEventMock
  ;(sandboxDO as any).ns = 'https://sandbox.example.com'

  return { sandboxDO, mockState, mockEnv, logActionMock, emitMock, emitEventMock }
}

/**
 * Helper function to make HTTP requests to the SandboxDO
 */
async function request(
  sandboxDO: SandboxDO,
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  }
  if (body !== undefined) {
    options.body = JSON.stringify(body)
  }
  const url = `https://sandbox.example.com${path}`
  const req = new Request(url, options)
  return sandboxDO.fetch(req)
}

// ============================================================================
// TESTS
// ============================================================================

describe('Sandbox DO HTTP Routes', () => {
  let sandboxDO: SandboxDO
  let mockSandbox: MockSandbox
  let mockState: ReturnType<typeof createMockDOState>
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(async () => {
    vi.clearAllMocks()
    const setup = await createTestSandboxDO()
    sandboxDO = setup.sandboxDO
    mockState = setup.mockState
    mockEnv = setup.mockEnv
    mockSandbox = createMockSandbox()
    mockGetSandbox.mockReturnValue(mockSandbox)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================================================
  // 1. POST /create - creates sandbox session with options
  // ==========================================================================

  describe('POST /create - Create sandbox session', () => {
    it('returns 200 with session info on success', async () => {
      const res = await request(sandboxDO, 'POST', '/create', {})

      expect(res.status).toBe(200)
      const body = (await res.json()) as SandboxCreateResult
      expect(body.sessionId).toBeDefined()
      expect(body.status).toBe('created')
    })

    it('accepts sleepAfter option', async () => {
      const res = await request(sandboxDO, 'POST', '/create', {
        sleepAfter: '30m',
      })

      expect(res.status).toBe(200)
      expect(mockGetSandbox).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ sleepAfter: '30m' })
      )
    })

    it('accepts keepAlive option', async () => {
      const res = await request(sandboxDO, 'POST', '/create', {
        keepAlive: true,
      })

      expect(res.status).toBe(200)
      expect(mockGetSandbox).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ keepAlive: true })
      )
    })

    it('returns 409 if session already exists', async () => {
      // Create first session
      await request(sandboxDO, 'POST', '/create', {})

      // Try to create second session
      const res = await request(sandboxDO, 'POST', '/create', {})

      expect(res.status).toBe(409)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('already')
    })
  })

  // ==========================================================================
  // 2. POST /exec - executes command, returns ExecResult
  // ==========================================================================

  describe('POST /exec - Execute command', () => {
    beforeEach(async () => {
      // Create a session first
      await request(sandboxDO, 'POST', '/create', {})
    })

    it('returns 200 with exec result on success', async () => {
      const res = await request(sandboxDO, 'POST', '/exec', {
        command: 'echo hello',
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as ExecResult
      expect(body.stdout).toBeDefined()
      expect(body.stderr).toBeDefined()
      expect(body.exitCode).toBeDefined()
      expect(body.success).toBeDefined()
    })

    it('calls sandbox.exec() with the command', async () => {
      await request(sandboxDO, 'POST', '/exec', {
        command: 'ls -la',
      })

      expect(mockSandbox.exec).toHaveBeenCalledWith('ls -la')
    })

    it('returns 400 for missing command', async () => {
      const res = await request(sandboxDO, 'POST', '/exec', {})

      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('command')
    })

    it('returns 400 when no active session', async () => {
      const { sandboxDO: newSandboxDO } = await createTestSandboxDO()

      const res = await request(newSandboxDO, 'POST', '/exec', {
        command: 'echo hello',
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('session')
    })

    it('returns error details when command fails', async () => {
      mockSandbox.exec.mockResolvedValueOnce({
        stdout: '',
        stderr: 'command not found',
        exitCode: 127,
        success: false,
      })

      const res = await request(sandboxDO, 'POST', '/exec', {
        command: 'nonexistent',
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as ExecResult
      expect(body.success).toBe(false)
      expect(body.exitCode).toBe(127)
    })
  })

  // ==========================================================================
  // 3. POST /exec/stream - returns SSE stream of output
  // ==========================================================================

  describe('POST /exec/stream - Execute command with streaming', () => {
    beforeEach(async () => {
      await request(sandboxDO, 'POST', '/create', {})
    })

    it('returns 200 with SSE content-type', async () => {
      const res = await request(sandboxDO, 'POST', '/exec/stream', {
        command: 'echo hello',
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/event-stream')
    })

    it('calls sandbox.execStream() with the command', async () => {
      await request(sandboxDO, 'POST', '/exec/stream', {
        command: 'tail -f log.txt',
      })

      expect(mockSandbox.execStream).toHaveBeenCalledWith('tail -f log.txt')
    })

    it('returns 400 for missing command', async () => {
      const res = await request(sandboxDO, 'POST', '/exec/stream', {})

      expect(res.status).toBe(400)
    })

    it('returns 400 when no active session', async () => {
      const { sandboxDO: newSandboxDO } = await createTestSandboxDO()

      const res = await request(newSandboxDO, 'POST', '/exec/stream', {
        command: 'echo hello',
      })

      expect(res.status).toBe(400)
    })
  })

  // ==========================================================================
  // 4. POST /file/write - writes file to sandbox (path, content in body)
  // ==========================================================================

  describe('POST /file/write - Write file', () => {
    beforeEach(async () => {
      await request(sandboxDO, 'POST', '/create', {})
    })

    it('returns 200 with success on write', async () => {
      const res = await request(sandboxDO, 'POST', '/file/write', {
        path: '/app/index.ts',
        content: 'console.log("hello")',
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as { success: boolean }
      expect(body.success).toBe(true)
    })

    it('calls sandbox.writeFile() with path and content', async () => {
      await request(sandboxDO, 'POST', '/file/write', {
        path: '/app/test.js',
        content: 'const x = 1',
      })

      expect(mockSandbox.writeFile).toHaveBeenCalledWith(
        '/app/test.js',
        'const x = 1',
        expect.anything()
      )
    })

    it('supports base64 encoding', async () => {
      const res = await request(sandboxDO, 'POST', '/file/write', {
        path: '/app/image.png',
        content: 'iVBORw0KGgoAAAAN=',
        encoding: 'base64',
      })

      expect(res.status).toBe(200)
      expect(mockSandbox.writeFile).toHaveBeenCalledWith(
        '/app/image.png',
        'iVBORw0KGgoAAAAN=',
        expect.objectContaining({ encoding: 'base64' })
      )
    })

    it('returns 400 for missing path', async () => {
      const res = await request(sandboxDO, 'POST', '/file/write', {
        content: 'hello',
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('path')
    })

    it('returns 400 for missing content', async () => {
      const res = await request(sandboxDO, 'POST', '/file/write', {
        path: '/app/file.txt',
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('content')
    })

    it('returns 400 when no active session', async () => {
      const { sandboxDO: newSandboxDO } = await createTestSandboxDO()

      const res = await request(newSandboxDO, 'POST', '/file/write', {
        path: '/app/file.txt',
        content: 'hello',
      })

      expect(res.status).toBe(400)
    })
  })

  // ==========================================================================
  // 5. GET /file/read?path=... - reads file from sandbox
  // ==========================================================================

  describe('GET /file/read - Read file', () => {
    beforeEach(async () => {
      await request(sandboxDO, 'POST', '/create', {})
    })

    it('returns 200 with file content', async () => {
      const res = await request(sandboxDO, 'GET', '/file/read?path=/app/index.ts')

      expect(res.status).toBe(200)
      const body = (await res.json()) as { content: string }
      expect(body.content).toBeDefined()
    })

    it('calls sandbox.readFile() with path', async () => {
      await request(sandboxDO, 'GET', '/file/read?path=/app/config.json')

      expect(mockSandbox.readFile).toHaveBeenCalledWith('/app/config.json')
    })

    it('returns 400 for missing path parameter', async () => {
      const res = await request(sandboxDO, 'GET', '/file/read')

      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('path')
    })

    it('returns 400 when no active session', async () => {
      const { sandboxDO: newSandboxDO } = await createTestSandboxDO()

      const res = await request(newSandboxDO, 'GET', '/file/read?path=/app/file.txt')

      expect(res.status).toBe(400)
    })

    it('returns 404 when file not found', async () => {
      mockSandbox.readFile.mockRejectedValueOnce(new Error('File not found'))

      const res = await request(sandboxDO, 'GET', '/file/read?path=/nonexistent')

      expect(res.status).toBe(404)
    })
  })

  // ==========================================================================
  // 6. POST /port/expose - exposes port for preview URL
  // ==========================================================================

  describe('POST /port/expose - Expose port', () => {
    beforeEach(async () => {
      await request(sandboxDO, 'POST', '/create', {})
    })

    it('returns 200 with exposed port info', async () => {
      const res = await request(sandboxDO, 'POST', '/port/expose', {
        port: 3000,
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as ExposedPort
      expect(body.port).toBe(3000)
      expect(body.exposedAt).toBeDefined()
    })

    it('calls sandbox.exposePort() with port', async () => {
      await request(sandboxDO, 'POST', '/port/expose', {
        port: 8080,
      })

      expect(mockSandbox.exposePort).toHaveBeenCalledWith(8080, expect.anything())
    })

    it('accepts optional name', async () => {
      const res = await request(sandboxDO, 'POST', '/port/expose', {
        port: 3000,
        name: 'web-server',
      })

      expect(res.status).toBe(200)
      expect(mockSandbox.exposePort).toHaveBeenCalledWith(
        3000,
        expect.objectContaining({ name: 'web-server' })
      )
    })

    it('returns 400 for missing port', async () => {
      const res = await request(sandboxDO, 'POST', '/port/expose', {})

      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('port')
    })

    it('returns 400 for invalid port', async () => {
      const res = await request(sandboxDO, 'POST', '/port/expose', {
        port: -1,
      })

      expect(res.status).toBe(400)
    })

    it('returns 400 when no active session', async () => {
      const { sandboxDO: newSandboxDO } = await createTestSandboxDO()

      const res = await request(newSandboxDO, 'POST', '/port/expose', {
        port: 3000,
      })

      expect(res.status).toBe(400)
    })
  })

  // ==========================================================================
  // 7. GET /ports - lists exposed ports
  // ==========================================================================

  describe('GET /ports - List exposed ports', () => {
    beforeEach(async () => {
      await request(sandboxDO, 'POST', '/create', {})
    })

    it('returns 200 with list of exposed ports', async () => {
      const res = await request(sandboxDO, 'GET', '/ports')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ExposedPort[]
      expect(Array.isArray(body)).toBe(true)
    })

    it('calls sandbox.getExposedPorts()', async () => {
      await request(sandboxDO, 'GET', '/ports')

      expect(mockSandbox.getExposedPorts).toHaveBeenCalled()
    })

    it('returns port details', async () => {
      const res = await request(sandboxDO, 'GET', '/ports')

      const body = (await res.json()) as ExposedPort[]
      expect(body[0].port).toBe(3000)
      expect(body[0].exposedAt).toBeDefined()
      expect(body[0].name).toBe('web')
    })

    it('returns 400 when no active session', async () => {
      const { sandboxDO: newSandboxDO } = await createTestSandboxDO()

      const res = await request(newSandboxDO, 'GET', '/ports')

      expect(res.status).toBe(400)
    })
  })

  // ==========================================================================
  // 8. GET /state - returns session state (status, exposedPorts, etc)
  // ==========================================================================

  describe('GET /state - Get session state', () => {
    it('returns 200 with idle status when no session', async () => {
      const res = await request(sandboxDO, 'GET', '/state')

      expect(res.status).toBe(200)
      const body = (await res.json()) as SandboxState
      expect(body.status).toBe('idle')
    })

    it('returns running status when session is active', async () => {
      await request(sandboxDO, 'POST', '/create', {})

      const res = await request(sandboxDO, 'GET', '/state')

      expect(res.status).toBe(200)
      const body = (await res.json()) as SandboxState
      expect(body.status).toBe('running')
    })

    it('returns exposed ports in state', async () => {
      await request(sandboxDO, 'POST', '/create', {})

      const res = await request(sandboxDO, 'GET', '/state')

      const body = (await res.json()) as SandboxState
      expect(body.exposedPorts).toBeDefined()
      expect(Array.isArray(body.exposedPorts)).toBe(true)
    })

    it('returns createdAt timestamp when session is active', async () => {
      await request(sandboxDO, 'POST', '/create', {})

      const res = await request(sandboxDO, 'GET', '/state')

      const body = (await res.json()) as SandboxState
      expect(body.createdAt).toBeDefined()
    })

    it('returns stopped status after destroy', async () => {
      await request(sandboxDO, 'POST', '/create', {})
      await request(sandboxDO, 'POST', '/destroy', {})

      const res = await request(sandboxDO, 'GET', '/state')

      const body = (await res.json()) as SandboxState
      expect(body.status).toBe('stopped')
    })
  })

  // ==========================================================================
  // 9. POST /destroy - tears down sandbox
  // ==========================================================================

  describe('POST /destroy - Destroy sandbox', () => {
    beforeEach(async () => {
      await request(sandboxDO, 'POST', '/create', {})
    })

    it('returns 200 with success', async () => {
      const res = await request(sandboxDO, 'POST', '/destroy', {})

      expect(res.status).toBe(200)
      const body = (await res.json()) as { success: boolean }
      expect(body.success).toBe(true)
    })

    it('calls sandbox.destroy()', async () => {
      await request(sandboxDO, 'POST', '/destroy', {})

      expect(mockSandbox.destroy).toHaveBeenCalled()
    })

    it('clears session after destroy', async () => {
      await request(sandboxDO, 'POST', '/destroy', {})

      // Check state to confirm session is stopped
      const stateRes = await request(sandboxDO, 'GET', '/state')
      const state = (await stateRes.json()) as SandboxState
      expect(state.status).toBe('stopped')
    })

    it('returns 400 when no active session', async () => {
      const { sandboxDO: newSandboxDO } = await createTestSandboxDO()

      const res = await request(newSandboxDO, 'POST', '/destroy', {})

      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('session')
    })
  })

  // ==========================================================================
  // 10. GET /terminal - upgrades to WebSocket
  // ==========================================================================

  describe('GET /terminal - WebSocket terminal', () => {
    beforeEach(async () => {
      await request(sandboxDO, 'POST', '/create', {})
    })

    it('returns 426 without Upgrade header', async () => {
      const res = await request(sandboxDO, 'GET', '/terminal')

      expect(res.status).toBe(426)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('WebSocket')
    })

    it('returns 400 when no active session', async () => {
      const { sandboxDO: newSandboxDO } = await createTestSandboxDO()

      const res = await request(newSandboxDO, 'GET', '/terminal')

      expect([400, 426]).toContain(res.status)
    })
  })

  // ==========================================================================
  // 11. Invalid route returns 404
  // ==========================================================================

  describe('Invalid routes', () => {
    it('returns 404 for unknown routes', async () => {
      const res = await request(sandboxDO, 'GET', '/unknown')

      expect(res.status).toBe(404)
    })

    it('returns JSON error for 404 responses', async () => {
      const res = await request(sandboxDO, 'GET', '/nonexistent')

      expect(res.headers.get('content-type')).toContain('application/json')
      const body = (await res.json()) as { error: string }
      expect(body.error).toBeDefined()
    })
  })

  // ==========================================================================
  // 12. Invalid body returns 400 with error message
  // ==========================================================================

  describe('Invalid request handling', () => {
    it('returns 400 for malformed JSON', async () => {
      const res = await sandboxDO.fetch(
        new Request('https://sandbox.example.com/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{ invalid json }',
        })
      )

      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBeDefined()
    })

    it('returns JSON error for all error responses', async () => {
      const res = await request(sandboxDO, 'POST', '/exec', {})

      expect(res.headers.get('content-type')).toContain('application/json')
    })

    it('includes error message in response body', async () => {
      const res = await request(sandboxDO, 'POST', '/exec', {})

      const body = (await res.json()) as { error: string }
      expect(body.error).toBeTruthy()
      expect(typeof body.error).toBe('string')
    })

    it('handles internal errors gracefully', async () => {
      await request(sandboxDO, 'POST', '/create', {})
      mockSandbox.exec.mockRejectedValueOnce(new Error('Internal error'))

      const res = await request(sandboxDO, 'POST', '/exec', {
        command: 'echo hello',
      })

      expect(res.status).toBe(500)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBeDefined()
    })
  })

  // ==========================================================================
  // HTTP Methods validation
  // ==========================================================================

  describe('HTTP Methods', () => {
    it('POST /create is supported', async () => {
      const res = await request(sandboxDO, 'POST', '/create', {})
      expect([200, 409]).toContain(res.status)
    })

    it('POST /exec is supported', async () => {
      const res = await request(sandboxDO, 'POST', '/exec', { command: 'echo' })
      expect([200, 400]).toContain(res.status)
    })

    it('POST /exec/stream is supported', async () => {
      const res = await request(sandboxDO, 'POST', '/exec/stream', { command: 'echo' })
      expect([200, 400]).toContain(res.status)
    })

    it('POST /file/write is supported', async () => {
      const res = await request(sandboxDO, 'POST', '/file/write', {
        path: '/app/f.txt',
        content: 'x',
      })
      expect([200, 400]).toContain(res.status)
    })

    it('GET /file/read is supported', async () => {
      const res = await request(sandboxDO, 'GET', '/file/read?path=/app/f.txt')
      expect([200, 400, 404]).toContain(res.status)
    })

    it('POST /port/expose is supported', async () => {
      const res = await request(sandboxDO, 'POST', '/port/expose', { port: 3000 })
      expect([200, 400]).toContain(res.status)
    })

    it('GET /ports is supported', async () => {
      const res = await request(sandboxDO, 'GET', '/ports')
      expect([200, 400]).toContain(res.status)
    })

    it('GET /state is supported', async () => {
      const res = await request(sandboxDO, 'GET', '/state')
      expect(res.status).toBe(200)
    })

    it('POST /destroy is supported', async () => {
      const res = await request(sandboxDO, 'POST', '/destroy', {})
      expect([200, 400]).toContain(res.status)
    })

    it('GET /terminal is supported', async () => {
      const res = await request(sandboxDO, 'GET', '/terminal')
      expect([400, 426]).toContain(res.status)
    })

    it('returns 405 for unsupported methods on known routes', async () => {
      const res = await sandboxDO.fetch(
        new Request('https://sandbox.example.com/create', { method: 'GET' })
      )
      expect(res.status).toBe(405)
    })
  })

  // ==========================================================================
  // Content-Type handling
  // ==========================================================================

  describe('Content-Type handling', () => {
    it('accepts application/json for POST requests', async () => {
      const res = await sandboxDO.fetch(
        new Request('https://sandbox.example.com/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
      )

      expect([200, 409]).toContain(res.status)
    })

    it('returns JSON content-type on all responses', async () => {
      const res = await request(sandboxDO, 'GET', '/state')

      expect(res.headers.get('content-type')).toContain('application/json')
    })
  })
})
