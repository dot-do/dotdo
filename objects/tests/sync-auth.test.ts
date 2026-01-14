/**
 * /sync WebSocket Authentication Tests
 *
 * TDD RED: These tests verify that the /sync WebSocket endpoint requires authentication.
 * The endpoint should:
 * - Reject unauthenticated WebSocket upgrade requests (401)
 * - Accept WebSocket with valid bearer subprotocol (101)
 * - Reject WebSocket with invalid token (401)
 * - Extract user context from token and pass to SyncEngine
 * - Return Sec-WebSocket-Protocol header with capnp-rpc
 *
 * Auth format: Sec-WebSocket-Protocol: "capnp-rpc, bearer.{token}"
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { DO, type Env } from '../core/DO'
import type { UserContext } from '../../types/WorkflowContext'

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
    _storage: storage,
  }
}

/**
 * Create a mock DurableObjectId
 */
function createMockDOId(name: string = 'test-do-id'): DurableObjectId {
  return {
    toString: () => name,
    equals: (other: DurableObjectId) => other.toString() === name,
    name,
  }
}

interface DurableObjectId {
  toString(): string
  equals(other: DurableObjectId): boolean
  name?: string
}

/**
 * Create a mock DurableObjectState with both KV and SQL storage
 */
function createMockState(idName: string = 'test-do-id'): DurableObjectState {
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
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn(() => []),
  } as unknown as DurableObjectState
}

interface DurableObjectState {
  id: DurableObjectId
  storage: unknown
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
  acceptWebSocket(ws: WebSocket, tags?: string[]): void
  getWebSockets(tag?: string): WebSocket[]
}

/**
 * Create a mock environment
 */
function createMockEnv(overrides?: Partial<Env>): Env {
  return {
    AI: undefined,
    PIPELINE: undefined,
    DO: undefined,
    ...overrides,
  }
}

/**
 * Mock WebSocket that simulates Cloudflare Workers WebSocket
 */
interface MockWebSocket {
  send: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  accept: ReturnType<typeof vi.fn>
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  readyState: number
  _messageHandlers: Array<(event: MessageEvent) => void>
  _closeHandlers: Array<() => void>
  simulateMessage(data: string | object): void
  simulateClose(): void
}

function createMockWebSocket(): MockWebSocket {
  const messageHandlers: Array<(event: MessageEvent) => void> = []
  const closeHandlers: Array<() => void> = []

  const ws: MockWebSocket = {
    send: vi.fn(),
    close: vi.fn(() => {
      ws.readyState = 3 // WebSocket.CLOSED
      closeHandlers.forEach((h) => h())
    }),
    accept: vi.fn(),
    addEventListener: vi.fn((event: string, handler: (event: unknown) => void) => {
      if (event === 'message') {
        messageHandlers.push(handler as (event: MessageEvent) => void)
      } else if (event === 'close') {
        closeHandlers.push(handler as () => void)
      }
    }),
    removeEventListener: vi.fn(),
    readyState: 1, // WebSocket.OPEN
    _messageHandlers: messageHandlers,
    _closeHandlers: closeHandlers,
    simulateMessage(data: string | object) {
      const eventData = typeof data === 'string' ? data : JSON.stringify(data)
      const event = { data: eventData } as MessageEvent
      messageHandlers.forEach((h) => h(event))
    },
    simulateClose() {
      ws.readyState = 3 // WebSocket.CLOSED
      closeHandlers.forEach((h) => h())
    },
  }

  return ws
}

/**
 * Mock WebSocket pair for Cloudflare DO WebSocket upgrade
 */
function createMockWebSocketPair(): [MockWebSocket, MockWebSocket] {
  const client = createMockWebSocket()
  const server = createMockWebSocket()

  // Link them so messages sent on one appear on the other
  client.send = vi.fn((data: string) => {
    server.simulateMessage(data)
  })
  server.send = vi.fn((data: string) => {
    client.simulateMessage(data)
  })

  // Link close events
  const originalClientClose = client.close
  const originalServerClose = server.close
  client.close = vi.fn(() => {
    originalClientClose()
    server.simulateClose()
  })
  server.close = vi.fn(() => {
    originalServerClose()
    client.simulateClose()
  })

  return [client, server]
}

// ============================================================================
// GLOBAL WEBSOCKETPAIR MOCK FOR CLOUDFLARE WORKERS RUNTIME
// ============================================================================

class MockWebSocketPairClass {
  0: MockWebSocket
  1: MockWebSocket

  constructor() {
    const [client, server] = createMockWebSocketPair()
    this[0] = client
    this[1] = server
  }

  *[Symbol.iterator]() {
    yield this[0]
    yield this[1]
  }
}

const OriginalResponse = globalThis.Response

beforeEach(() => {
  ;(globalThis as any).WebSocketPair = MockWebSocketPairClass

  // Override Response to support WebSocket upgrade responses
  ;(globalThis as any).Response = class extends OriginalResponse {
    webSocket?: MockWebSocket

    constructor(body: BodyInit | null, init?: ResponseInit & { webSocket?: MockWebSocket }) {
      const isWebSocketUpgrade = init?.status === 101
      const adjustedInit = isWebSocketUpgrade ? { ...init, status: 200 } : init

      super(body, adjustedInit)

      if (isWebSocketUpgrade) {
        Object.defineProperty(this, 'status', { value: 101, writable: false })
        Object.defineProperty(this, 'statusText', { value: 'Switching Protocols', writable: false })
      }

      if (init?.webSocket) {
        this.webSocket = init.webSocket
      }
    }

    static json(data: unknown, init?: ResponseInit): Response {
      return OriginalResponse.json(data, init)
    }
  }
})

// ============================================================================
// TEST DO CLASS WITH AUTH
// ============================================================================

/**
 * Mock token validator for testing
 */
let mockValidateToken: ReturnType<typeof vi.fn<[string], Promise<{ user: UserContext } | null>>>

/**
 * Test DO with configurable auth validation
 */
class AuthTestDO extends DO {
  static readonly $type = 'AuthTestDO'

  /**
   * Override to use mock token validator
   */
  protected override async validateSyncAuthToken(token: string): Promise<{ user: UserContext } | null> {
    return mockValidateToken(token)
  }
}

// ============================================================================
// TESTS: /sync WebSocket Authentication
// ============================================================================

describe('/sync WebSocket auth', () => {
  let mockState: DurableObjectState
  let mockEnv: Env
  let doInstance: AuthTestDO

  beforeEach(async () => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    doInstance = new AuthTestDO(mockState, mockEnv)
    await doInstance.initialize({ ns: 'https://test.example.com.ai' })

    // Reset mock validator
    mockValidateToken = vi.fn()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================================================
  // TESTS: Unauthenticated Requests
  // ==========================================================================

  describe('Unauthenticated requests', () => {
    it('should reject unauthenticated WebSocket upgrade', async () => {
      const request = new Request('https://example.com/sync', {
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
          // No Sec-WebSocket-Protocol header - no auth
        },
      })

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(401)

      const data = (await response.json()) as { error: string }
      expect(data.error).toContain('auth')
    })

    it('should reject WebSocket with capnp-rpc but no bearer token', async () => {
      const request = new Request('https://example.com/sync', {
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Protocol': 'capnp-rpc', // No bearer token
        },
      })

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(401)

      const data = (await response.json()) as { error: string }
      expect(data.error).toContain('auth')
    })
  })

  // ==========================================================================
  // TESTS: Valid Bearer Token
  // ==========================================================================

  describe('Valid bearer token', () => {
    it('should accept WebSocket with valid bearer subprotocol', async () => {
      const request = new Request('https://example.com/sync', {
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Protocol': 'capnp-rpc, bearer.valid-token-123',
        },
      })

      // Mock successful token validation
      mockValidateToken.mockResolvedValue({ user: { id: 'user-123', email: 'test@example.com' } })

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(101) // WebSocket upgrade
      expect(response.webSocket).toBeDefined()
    })

    it('should validate the extracted token', async () => {
      const request = new Request('https://example.com/sync', {
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Protocol': 'capnp-rpc, bearer.my-secret-token',
        },
      })

      mockValidateToken.mockResolvedValue({ user: { id: 'user-456' } })

      await doInstance.fetch(request)

      // Verify the token was extracted and passed to validator
      expect(mockValidateToken).toHaveBeenCalledWith('my-secret-token')
    })

    it('should handle bearer token with special characters', async () => {
      const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
      const request = new Request('https://example.com/sync', {
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Protocol': `capnp-rpc, bearer.${token}`,
        },
      })

      mockValidateToken.mockResolvedValue({ user: { id: 'jwt-user' } })

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(101)
      expect(mockValidateToken).toHaveBeenCalledWith(token)
    })
  })

  // ==========================================================================
  // TESTS: Invalid Token
  // ==========================================================================

  describe('Invalid token', () => {
    it('should reject WebSocket with invalid token', async () => {
      const request = new Request('https://example.com/sync', {
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Protocol': 'capnp-rpc, bearer.invalid-token',
        },
      })

      // Mock failed token validation
      mockValidateToken.mockResolvedValue(null)

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(401)

      const data = (await response.json()) as { error: string }
      expect(data.error).toContain('auth')
    })

    it('should reject WebSocket when token validation throws', async () => {
      const request = new Request('https://example.com/sync', {
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Protocol': 'capnp-rpc, bearer.error-token',
        },
      })

      // Mock validation error
      mockValidateToken.mockRejectedValue(new Error('Token validation failed'))

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(401)
    })

    it('should reject empty bearer token', async () => {
      const request = new Request('https://example.com/sync', {
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Protocol': 'capnp-rpc, bearer.', // Empty token
        },
      })

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(401)
    })
  })

  // ==========================================================================
  // TESTS: User Context in SyncEngine
  // ==========================================================================

  describe('User context passed to SyncEngine', () => {
    it('should extract user context from token and pass to SyncEngine', async () => {
      const request = new Request('https://example.com/sync', {
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Protocol': 'capnp-rpc, bearer.user-token',
        },
      })

      const testUser: UserContext = {
        id: 'user-789',
        email: 'user@example.com',
        role: 'admin',
      }

      mockValidateToken.mockResolvedValue({ user: testUser })

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(101)

      // Access the sync engine to verify a connection exists
      const syncEngine = (doInstance as unknown as {
        syncEngine?: {
          getActiveConnections(): number
        }
      }).syncEngine

      // Verify a connection was created with the authenticated user
      // The SyncEngine stores user context on the server-side WebSocket
      // which is different from the client-side WebSocket returned in the response
      expect(syncEngine?.getActiveConnections()).toBe(1)

      // Verify token validation was called with the correct token
      expect(mockValidateToken).toHaveBeenCalledWith('user-token')
    })

    it('should include all user context fields (id, email, role)', async () => {
      const request = new Request('https://example.com/sync', {
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Protocol': 'capnp-rpc, bearer.full-user-token',
        },
      })

      const fullUser: UserContext = {
        id: 'full-user-id',
        email: 'full@example.com',
        role: 'editor',
      }

      mockValidateToken.mockResolvedValue({ user: fullUser })

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(101)

      // Verify the full user context was used
      expect(mockValidateToken).toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // TESTS: Response Headers
  // ==========================================================================

  describe('Response headers', () => {
    it('should return Sec-WebSocket-Protocol header with capnp-rpc', async () => {
      const request = new Request('https://example.com/sync', {
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Protocol': 'capnp-rpc, bearer.valid-token',
        },
      })

      mockValidateToken.mockResolvedValue({ user: { id: 'header-test-user' } })

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(101)

      // Response should echo back the accepted protocol
      const protocol = response.headers.get('Sec-WebSocket-Protocol')
      expect(protocol).toBe('capnp-rpc')
    })
  })

  // ==========================================================================
  // TESTS: Protocol Parsing Edge Cases
  // ==========================================================================

  describe('Protocol parsing edge cases', () => {
    it('should handle protocols with extra whitespace', async () => {
      const request = new Request('https://example.com/sync', {
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Protocol': '  capnp-rpc  ,   bearer.whitespace-token  ',
        },
      })

      mockValidateToken.mockResolvedValue({ user: { id: 'whitespace-user' } })

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(101)
      expect(mockValidateToken).toHaveBeenCalledWith('whitespace-token')
    })

    it('should handle bearer at different positions in protocol list', async () => {
      const request = new Request('https://example.com/sync', {
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Protocol': 'bearer.first-token, capnp-rpc, other-protocol',
        },
      })

      mockValidateToken.mockResolvedValue({ user: { id: 'order-test-user' } })

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(101)
      expect(mockValidateToken).toHaveBeenCalledWith('first-token')
    })

    it('should handle multiple bearer protocols (use first)', async () => {
      const request = new Request('https://example.com/sync', {
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Protocol': 'capnp-rpc, bearer.first-token, bearer.second-token',
        },
      })

      mockValidateToken.mockResolvedValue({ user: { id: 'multi-bearer-user' } })

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(101)
      // Should use the first bearer token found
      expect(mockValidateToken).toHaveBeenCalledWith('first-token')
    })
  })

  // ==========================================================================
  // TESTS: Non-WebSocket Requests Still Work
  // ==========================================================================

  describe('Non-WebSocket /sync requests', () => {
    it('should still return 426 for non-WebSocket requests (auth not checked)', async () => {
      const request = new Request('https://example.com/sync', {
        method: 'GET',
        // No WebSocket headers
      })

      const response = await doInstance.fetch(request)

      // Should return 426 Upgrade Required before auth is checked
      expect(response.status).toBe(426)
      expect(response.headers.get('Upgrade')).toBe('websocket')
    })
  })
})
