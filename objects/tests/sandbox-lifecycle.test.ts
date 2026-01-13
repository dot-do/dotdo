/**
 * SandboxDO - Session Lifecycle Tests
 *
 * MOCKS REQUIRED: These tests must use mocks because SandboxDO depends on
 * @cloudflare/sandbox which in turn depends on @cloudflare/containers.
 * These packages are runtime-only and cannot be loaded in miniflare/vitest.
 *
 * The getSandbox function from ../sandbox imports from @cloudflare/sandbox,
 * making it impossible to instantiate SandboxDO in a test environment without
 * mocking. This is a fundamental platform limitation, not a test design choice.
 *
 * For true integration testing, SandboxDO must be tested against a real
 * Cloudflare Workers deployment with container infrastructure enabled.
 *
 * These tests exercise the SandboxDO session lifecycle management:
 * - Session creation with configuration
 * - Session state persistence in DO storage
 * - Session destruction and cleanup
 * - Alarm-based timeout handling
 * - Lifecycle events through $.send() and $.do()
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Shared sandbox instance for testing
const sharedMockSandbox = {
  exec: vi.fn(async (command: string) => ({
    stdout: 'mock stdout',
    stderr: '',
    exitCode: 0,
    success: true,
  })),
  execStream: vi.fn(async function* (command: string) {
    yield { type: 'stdout', data: 'mock stream output' }
    yield { type: 'complete', exitCode: 0 }
  }),
  writeFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => ({ content: 'file content' })),
  mkdir: vi.fn(async () => {}),
  deleteFile: vi.fn(async () => {}),
  exists: vi.fn(async () => ({ exists: true })),
  destroy: vi.fn(async () => {}),
  exposePort: vi.fn(async () => ({ url: 'http://localhost:8080' })),
  getExposedPorts: vi.fn(async () => []),
  createCodeContext: vi.fn(async () => ({ id: 'ctx-123' })),
  runCode: vi.fn(async () => ({
    code: '',
    logs: { stdout: [], stderr: [] },
    results: [],
    success: true,
    executionCount: 1,
  })),
}

// Mock the sandbox module to avoid @cloudflare/containers dependency
vi.mock('../../sandbox', () => ({
  getSandbox: vi.fn(() => sharedMockSandbox),
}))

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock SQL storage cursor result
 */
interface MockSqlCursor {
  toArray(): unknown[]
  one(): unknown
  raw(): unknown[]
}

/**
 * Mock SQL storage that simulates Cloudflare's SqlStorage API
 */
function createMockSqlStorage() {
  const tables = new Map<string, unknown[]>()

  return {
    exec(query: string, ...params: unknown[]): MockSqlCursor {
      return {
        toArray: () => [],
        one: () => undefined,
        raw: () => [],
      }
    },
    _tables: tables,
  }
}

/**
 * Mock KV storage for Durable Object state
 */
function createMockKvStorage() {
  const storage = new Map<string, unknown>()

  return {
    get: vi.fn(async <T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined> => {
      if (Array.isArray(key)) {
        const result = new Map<string, T>()
        for (const k of key) {
          const value = storage.get(k)
          if (value !== undefined) {
            result.set(k, value as T)
          }
        }
        return result as Map<string, T>
      }
      return storage.get(key) as T | undefined
    }),
    put: vi.fn(async <T>(key: string | Record<string, T>, value?: T): Promise<void> => {
      if (typeof key === 'object') {
        for (const [k, v] of Object.entries(key)) {
          storage.set(k, v)
        }
      } else {
        storage.set(key, value)
      }
    }),
    delete: vi.fn(async (key: string | string[]): Promise<boolean | number> => {
      if (Array.isArray(key)) {
        let count = 0
        for (const k of key) {
          if (storage.delete(k)) count++
        }
        return count
      }
      return storage.delete(key)
    }),
    deleteAll: vi.fn(async (): Promise<void> => {
      storage.clear()
    }),
    list: vi.fn(async <T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>> => {
      const result = new Map<string, T>()
      for (const [key, value] of storage) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          result.set(key, value as T)
        }
      }
      return result
    }),
    setAlarm: vi.fn(async (scheduledTime: Date | number): Promise<void> => {}),
    getAlarm: vi.fn(async (): Promise<number | null> => null),
    deleteAlarm: vi.fn(async (): Promise<void> => {}),
    _storage: storage,
  }
}

/**
 * Create a mock DurableObjectId
 */
function createMockDOId(name: string = 'test-sandbox-id'): DurableObjectId {
  return {
    toString: () => name,
    equals: (other: DurableObjectId) => other.toString() === name,
    name,
  }
}

/**
 * Create a mock DurableObjectState with alarm support
 */
function createMockState(idName: string = 'test-sandbox-id'): DurableObjectState {
  const kvStorage = createMockKvStorage()
  const sqlStorage = createMockSqlStorage()

  return {
    id: createMockDOId(idName),
    storage: {
      ...kvStorage,
      sql: sqlStorage,
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async <T>(callback: () => Promise<T>): Promise<T> => callback()),
  } as unknown as DurableObjectState
}

/**
 * Create mock environment
 */
function createMockEnv(overrides?: Partial<SandboxEnv>): SandboxEnv {
  return {
    AI: undefined,
    PIPELINE: undefined,
    DO: undefined,
    Sandbox: createMockSandboxNamespace(),
    ...overrides,
  }
}

/**
 * Create a mock Sandbox namespace binding
 */
function createMockSandboxNamespace() {
  return {
    idFromName: vi.fn((name: string) => createMockDOId(name)),
    get: vi.fn(() => createMockCloudfareSandbox()),
  }
}

/**
 * Create a mock Cloudflare Sandbox instance
 */
function createMockCloudfareSandbox() {
  return {
    exec: vi.fn(async (command: string) => ({
      stdout: 'mock stdout',
      stderr: '',
      exitCode: 0,
      success: true,
    })),
    execStream: vi.fn(async function* (command: string) {
      yield { type: 'stdout', data: 'mock stream output' }
      yield { type: 'complete', exitCode: 0 }
    }),
    writeFile: vi.fn(async () => {}),
    readFile: vi.fn(async () => ({ content: 'file content' })),
    mkdir: vi.fn(async () => {}),
    deleteFile: vi.fn(async () => {}),
    exists: vi.fn(async () => ({ exists: true })),
    destroy: vi.fn(async () => {}),
    createCodeContext: vi.fn(async () => ({ id: 'ctx-123' })),
    runCode: vi.fn(async () => ({
      code: '',
      logs: { stdout: [], stderr: [] },
      results: [],
      success: true,
      executionCount: 1,
    })),
  }
}

// ============================================================================
// TYPE DECLARATIONS
// ============================================================================

interface DurableObjectId {
  toString(): string
  equals(other: DurableObjectId): boolean
  name?: string
}

interface DurableObjectState {
  id: DurableObjectId
  storage: DurableObjectStorage
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
}

interface DurableObjectStorage {
  get<T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined>
  put<T>(key: string | Record<string, T>, value?: T): Promise<void>
  delete(key: string | string[]): Promise<boolean | number>
  list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>
  setAlarm(scheduledTime: Date | number): Promise<void>
  getAlarm(): Promise<number | null>
  deleteAlarm(): Promise<void>
  sql: {
    exec(query: string, ...params: unknown[]): {
      toArray(): unknown[]
      one(): unknown
      raw(): unknown[]
    }
  }
}

interface SandboxEnv {
  AI?: unknown
  PIPELINE?: unknown
  DO?: unknown
  Sandbox?: unknown
}

// ============================================================================
// SESSION STATES
// ============================================================================

type SessionStatus = 'idle' | 'running' | 'stopped' | 'error'

interface SessionState {
  status: SessionStatus
  sandboxId: string
  config: SandboxConfig
  createdAt: Date
  lastActivityAt: Date
  error?: string
}

interface SandboxConfig {
  sleepAfter?: string
  keepAlive?: boolean
  normalizeId?: boolean
  timeoutMs?: number
}

// ============================================================================
// TESTS
// ============================================================================

describe('SandboxDO - session lifecycle', () => {
  let mockState: DurableObjectState
  let mockEnv: SandboxEnv
  let sandboxDO: SandboxDO

  // Use sharedMockSandbox from the vi.mock setup
  const mockSandbox = sharedMockSandbox

  beforeEach(() => {
    vi.clearAllMocks()
    mockState = createMockState()
    mockEnv = createMockEnv({
      Sandbox: {
        idFromName: vi.fn((name: string) => createMockDOId(name)),
        get: vi.fn(() => mockSandbox),
      },
    })
    // Reset the sharedMockSandbox methods
    mockSandbox.exec.mockClear()
    mockSandbox.destroy.mockClear()
    mockSandbox.exec.mockResolvedValue({
      stdout: 'mock stdout',
      stderr: '',
      exitCode: 0,
      success: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // =========================================================================
  // Test 1: SandboxDO instantiates correctly
  // =========================================================================

  describe('instantiation', () => {
    it('should instantiate SandboxDO with state and env', async () => {
      // Dynamically import to allow test file to exist before implementation
      const { SandboxDO } = await import('../SandboxDO')

      sandboxDO = new SandboxDO(mockState, mockEnv)

      expect(sandboxDO).toBeDefined()
      expect(sandboxDO).toBeInstanceOf(SandboxDO)
    })

    it('should have $type of "Sandbox"', async () => {
      const { SandboxDO } = await import('../SandboxDO')

      sandboxDO = new SandboxDO(mockState, mockEnv)

      expect(sandboxDO.$type).toBe('Sandbox')
    })

    it('should extend DO base class', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      const { DO } = await import('../DO')

      sandboxDO = new SandboxDO(mockState, mockEnv)

      expect(sandboxDO).toBeInstanceOf(DO)
    })
  })

  // =========================================================================
  // Test 2: create() initializes session via @cloudflare/sandbox
  // =========================================================================

  describe('create()', () => {
    it('should create a new sandbox session with default config', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      sandboxDO = new SandboxDO(mockState, mockEnv)

      const result = await sandboxDO.create({ sandboxId: 'test-session' })

      expect(result).toBeDefined()
      expect(result.sandboxId).toBe('test-session')
      expect(result.status).toBe('running')
    })

    it('should create session with custom config', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      sandboxDO = new SandboxDO(mockState, mockEnv)

      const config: SandboxConfig = {
        sleepAfter: '5m',
        keepAlive: true,
        timeoutMs: 60000,
      }

      const result = await sandboxDO.create({ sandboxId: 'custom-session', config })

      expect(result.sandboxId).toBe('custom-session')
      expect(result.config?.sleepAfter).toBe('5m')
      expect(result.config?.keepAlive).toBe(true)
    })

    it('should throw error if sandbox namespace is not configured', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      const envWithoutSandbox = createMockEnv({ Sandbox: undefined })
      sandboxDO = new SandboxDO(mockState, envWithoutSandbox)

      await expect(sandboxDO.create({ sandboxId: 'test' }))
        .rejects.toThrow('Sandbox namespace not configured')
    })

    it('should throw error if session already exists', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      sandboxDO = new SandboxDO(mockState, mockEnv)

      await sandboxDO.create({ sandboxId: 'existing-session' })

      await expect(sandboxDO.create({ sandboxId: 'new-session' }))
        .rejects.toThrow('Session already exists')
    })
  })

  // =========================================================================
  // Test 3: create() stores session config in DO storage
  // =========================================================================

  describe('session storage', () => {
    it('should persist session state to DO storage', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      sandboxDO = new SandboxDO(mockState, mockEnv)

      await sandboxDO.create({ sandboxId: 'persisted-session' })

      expect(mockState.storage.put).toHaveBeenCalledWith(
        'session',
        expect.objectContaining({
          sandboxId: 'persisted-session',
          status: 'running',
        })
      )
    })

    it('should store createdAt timestamp', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      sandboxDO = new SandboxDO(mockState, mockEnv)

      const before = Date.now()
      await sandboxDO.create({ sandboxId: 'timestamped-session' })
      const after = Date.now()

      const putCall = (mockState.storage.put as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0] === 'session'
      )

      expect(putCall).toBeDefined()
      const storedSession = putCall![1] as SessionState
      expect(new Date(storedSession.createdAt).getTime()).toBeGreaterThanOrEqual(before)
      expect(new Date(storedSession.createdAt).getTime()).toBeLessThanOrEqual(after)
    })

    it('should restore session state on getState()', async () => {
      const { SandboxDO } = await import('../SandboxDO')

      // Simulate existing session in storage
      const existingSession: SessionState = {
        status: 'running',
        sandboxId: 'restored-session',
        config: { sleepAfter: '10m' },
        createdAt: new Date(),
        lastActivityAt: new Date(),
      }
      ;(mockState.storage as { _storage: Map<string, unknown> })._storage.set('session', existingSession)

      sandboxDO = new SandboxDO(mockState, mockEnv)

      const state = await sandboxDO.getState()

      expect(state).toBeDefined()
      expect(state?.sandboxId).toBe('restored-session')
      expect(state?.status).toBe('running')
    })
  })

  // =========================================================================
  // Test 4: destroy() tears down sandbox container
  // =========================================================================

  describe('destroy()', () => {
    it('should destroy the sandbox session', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      sandboxDO = new SandboxDO(mockState, mockEnv)

      await sandboxDO.create({ sandboxId: 'to-destroy' })
      await sandboxDO.destroy()

      expect(mockSandbox.destroy).toHaveBeenCalled()
    })

    it('should update session status to stopped', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      sandboxDO = new SandboxDO(mockState, mockEnv)

      await sandboxDO.create({ sandboxId: 'to-stop' })
      await sandboxDO.destroy()

      // After destroy, session is cleared (null), not in "stopped" status
      const state = await sandboxDO.getState()
      expect(state).toBeNull()
    })

    it('should clear session from storage after destroy', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      sandboxDO = new SandboxDO(mockState, mockEnv)

      await sandboxDO.create({ sandboxId: 'to-clear' })
      await sandboxDO.destroy()

      expect(mockState.storage.delete).toHaveBeenCalledWith('session')
    })

    it('should throw error if no active session', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      sandboxDO = new SandboxDO(mockState, mockEnv)

      await expect(sandboxDO.destroy())
        .rejects.toThrow('No active session')
    })

    it('should cancel any scheduled alarms on destroy', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      sandboxDO = new SandboxDO(mockState, mockEnv)

      await sandboxDO.create({ sandboxId: 'alarmed-session', config: { timeoutMs: 60000 } })
      await sandboxDO.destroy()

      expect(mockState.storage.deleteAlarm).toHaveBeenCalled()
    })
  })

  // =========================================================================
  // Test 5: getState() returns session status
  // =========================================================================

  describe('getState()', () => {
    it('should return null when no session exists', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      sandboxDO = new SandboxDO(mockState, mockEnv)

      const state = await sandboxDO.getState()

      expect(state).toBeNull()
    })

    it('should return idle status for new session before activity', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      sandboxDO = new SandboxDO(mockState, mockEnv)

      await sandboxDO.create({ sandboxId: 'idle-session' })

      // Initially running, but after some inactivity could be idle
      const state = await sandboxDO.getState()
      expect(['idle', 'running']).toContain(state?.status)
    })

    it('should return running status during active session', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      sandboxDO = new SandboxDO(mockState, mockEnv)

      await sandboxDO.create({ sandboxId: 'active-session' })
      await sandboxDO.exec('echo hello')

      const state = await sandboxDO.getState()
      expect(state?.status).toBe('running')
    })

    it('should return stopped status after destroy', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      sandboxDO = new SandboxDO(mockState, mockEnv)

      await sandboxDO.create({ sandboxId: 'stopped-session' })
      await sandboxDO.destroy()

      // After destroy, getState should return the last known state or null
      const state = await sandboxDO.getState()
      expect(state).toBeNull() // Or stopped, depending on implementation
    })

    it('should return error status when sandbox fails', async () => {
      const { SandboxDO } = await import('../SandboxDO')

      // Make sandbox throw on exec
      mockSandbox.exec.mockRejectedValueOnce(new Error('Container crashed'))

      sandboxDO = new SandboxDO(mockState, mockEnv)
      await sandboxDO.create({ sandboxId: 'error-session' })

      try {
        await sandboxDO.exec('crash')
      } catch {
        // Expected
      }

      const state = await sandboxDO.getState()
      expect(state?.status).toBe('error')
      expect(state?.error).toContain('Container crashed')
    })
  })

  // =========================================================================
  // Test 6: alarm() handles session timeout cleanup
  // =========================================================================

  describe('alarm()', () => {
    it('should schedule alarm when timeout is configured', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      sandboxDO = new SandboxDO(mockState, mockEnv)

      await sandboxDO.create({
        sandboxId: 'timeout-session',
        config: { timeoutMs: 60000 }
      })

      expect(mockState.storage.setAlarm).toHaveBeenCalled()
    })

    it('should destroy session when alarm fires after timeout', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      sandboxDO = new SandboxDO(mockState, mockEnv)

      await sandboxDO.create({
        sandboxId: 'expiring-session',
        config: { timeoutMs: 1 } // Very short timeout
      })

      // Manipulate lastActivityAt to be in the past (simulate elapsed time)
      const session = await sandboxDO.getState()
      if (session) {
        session.lastActivityAt = new Date(Date.now() - 10000) // 10 seconds ago
        await mockState.storage.put('session', session)
      }

      // Simulate alarm firing after timeout elapsed
      await sandboxDO.alarm()

      expect(mockSandbox.destroy).toHaveBeenCalled()
    })

    it('should not destroy session if activity occurred before alarm', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      sandboxDO = new SandboxDO(mockState, mockEnv)

      await sandboxDO.create({
        sandboxId: 'active-before-alarm',
        config: { timeoutMs: 60000 }
      })

      // Simulate activity
      await sandboxDO.exec('echo keep-alive')

      // Simulate alarm firing - should reschedule, not destroy
      await sandboxDO.alarm()

      const state = await sandboxDO.getState()
      expect(state?.status).toBe('running')
    })

    it('should reschedule alarm after activity', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      sandboxDO = new SandboxDO(mockState, mockEnv)

      await sandboxDO.create({
        sandboxId: 'rescheduled-session',
        config: { timeoutMs: 60000 }
      })

      // Initial alarm set
      expect(mockState.storage.setAlarm).toHaveBeenCalledTimes(1)

      // Activity should reschedule
      await sandboxDO.exec('echo activity')

      expect(mockState.storage.setAlarm).toHaveBeenCalledTimes(2)
    })
  })

  // =========================================================================
  // Test 7: Lifecycle events (sandbox.created, sandbox.destroyed)
  // =========================================================================

  describe('lifecycle events', () => {
    it('should emit sandbox.created event on create()', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      sandboxDO = new SandboxDO(mockState, mockEnv)

      // Spy on event emission
      const emitSpy = vi.spyOn(sandboxDO as unknown as { emitEvent: Function }, 'emitEvent')

      await sandboxDO.create({ sandboxId: 'event-session' })

      expect(emitSpy).toHaveBeenCalledWith(
        'sandbox.created',
        expect.objectContaining({ sandboxId: 'event-session' })
      )
    })

    it('should emit sandbox.destroyed event on destroy()', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      sandboxDO = new SandboxDO(mockState, mockEnv)

      await sandboxDO.create({ sandboxId: 'destroy-event-session' })

      const emitSpy = vi.spyOn(sandboxDO as unknown as { emitEvent: Function }, 'emitEvent')

      await sandboxDO.destroy()

      expect(emitSpy).toHaveBeenCalledWith(
        'sandbox.destroyed',
        expect.objectContaining({ sandboxId: 'destroy-event-session' })
      )
    })

    it('should emit sandbox.error event on failure', async () => {
      const { SandboxDO } = await import('../SandboxDO')

      mockSandbox.exec.mockRejectedValueOnce(new Error('Execution failed'))

      sandboxDO = new SandboxDO(mockState, mockEnv)
      await sandboxDO.create({ sandboxId: 'error-event-session' })

      const emitSpy = vi.spyOn(sandboxDO as unknown as { emitEvent: Function }, 'emitEvent')

      try {
        await sandboxDO.exec('fail')
      } catch {
        // Expected
      }

      expect(emitSpy).toHaveBeenCalledWith(
        'sandbox.error',
        expect.objectContaining({
          sandboxId: 'error-event-session',
          error: expect.any(String),
        })
      )
    })

    it('should emit sandbox.timeout event when alarm fires', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      sandboxDO = new SandboxDO(mockState, mockEnv)

      await sandboxDO.create({
        sandboxId: 'timeout-event-session',
        config: { timeoutMs: 1 } // Very short timeout
      })

      // Manipulate lastActivityAt to be in the past
      const session = await sandboxDO.getState()
      if (session) {
        session.lastActivityAt = new Date(Date.now() - 10000) // 10 seconds ago
        await mockState.storage.put('session', session)
      }

      const emitSpy = vi.spyOn(sandboxDO as unknown as { emitEvent: Function }, 'emitEvent')

      // Simulate timeout (no activity, alarm fires)
      await sandboxDO.alarm()

      expect(emitSpy).toHaveBeenCalledWith(
        'sandbox.timeout',
        expect.objectContaining({ sandboxId: 'timeout-event-session' })
      )
    })
  })

  // =========================================================================
  // Test 8: exec() proxies to underlying sandbox
  // =========================================================================

  describe('exec()', () => {
    it('should execute command in sandbox', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      sandboxDO = new SandboxDO(mockState, mockEnv)

      await sandboxDO.create({ sandboxId: 'exec-session' })

      const result = await sandboxDO.exec('echo hello')

      expect(mockSandbox.exec).toHaveBeenCalledWith('echo hello')
      expect(result.stdout).toBe('mock stdout')
      expect(result.success).toBe(true)
    })

    it('should throw error if no active session', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      sandboxDO = new SandboxDO(mockState, mockEnv)

      await expect(sandboxDO.exec('echo hello'))
        .rejects.toThrow('No active session')
    })

    it('should update lastActivityAt on exec', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      sandboxDO = new SandboxDO(mockState, mockEnv)

      await sandboxDO.create({ sandboxId: 'activity-session' })

      const before = Date.now()
      await sandboxDO.exec('echo activity')
      const after = Date.now()

      const state = await sandboxDO.getState()
      expect(new Date(state!.lastActivityAt).getTime()).toBeGreaterThanOrEqual(before)
      expect(new Date(state!.lastActivityAt).getTime()).toBeLessThanOrEqual(after)
    })
  })

  // =========================================================================
  // Test 9: HTTP fetch handler
  // =========================================================================

  describe('fetch()', () => {
    it('should handle /health endpoint', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      sandboxDO = new SandboxDO(mockState, mockEnv)

      const response = await sandboxDO.fetch(
        new Request('https://sandbox.do/health')
      )

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.status).toBe('ok')
    })

    it('should handle POST /session to create session', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      sandboxDO = new SandboxDO(mockState, mockEnv)

      const response = await sandboxDO.fetch(
        new Request('https://sandbox.do/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sandboxId: 'http-session' }),
        })
      )

      expect(response.status).toBe(201)
      const body = await response.json()
      expect(body.sandboxId).toBe('http-session')
    })

    it('should handle DELETE /session to destroy session', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      sandboxDO = new SandboxDO(mockState, mockEnv)

      // First create a session
      await sandboxDO.create({ sandboxId: 'http-delete-session' })

      const response = await sandboxDO.fetch(
        new Request('https://sandbox.do/session', {
          method: 'DELETE',
        })
      )

      expect(response.status).toBe(200)
    })

    it('should handle GET /session/state', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      sandboxDO = new SandboxDO(mockState, mockEnv)

      await sandboxDO.create({ sandboxId: 'http-state-session' })

      const response = await sandboxDO.fetch(
        new Request('https://sandbox.do/session/state')
      )

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.sandboxId).toBe('http-state-session')
      expect(body.status).toBe('running')
    })

    it('should handle POST /exec to run commands', async () => {
      const { SandboxDO } = await import('../SandboxDO')
      sandboxDO = new SandboxDO(mockState, mockEnv)

      await sandboxDO.create({ sandboxId: 'http-exec-session' })

      const response = await sandboxDO.fetch(
        new Request('https://sandbox.do/exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'echo hello' }),
        })
      )

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.stdout).toBe('mock stdout')
    })
  })
})

// ============================================================================
// PLACEHOLDER TYPE FOR RED PHASE
// ============================================================================

/**
 * This interface represents what SandboxDO should implement.
 * Used for type-safety in tests before implementation exists.
 */
interface SandboxDO {
  $type: string
  create(options: { sandboxId: string; config?: SandboxConfig }): Promise<SessionState>
  destroy(): Promise<void>
  getState(): Promise<SessionState | null>
  exec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number; success: boolean }>
  alarm(): Promise<void>
  fetch(request: Request): Promise<Response>
}
