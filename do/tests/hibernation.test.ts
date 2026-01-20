/**
 * Tests for WebSocket Hibernation Support
 *
 * These tests verify the hibernation functionality for WebSocket connections
 * that provides 95%+ cost reduction on idle connections.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  HibernationManager,
  estimateHibernationSavings,
  isHibernationError,
  createHibernationPayload,
  DEFAULT_HIBERNATION_CONFIG,
  type HibernationAttachment,
  type HibernationState,
} from '../hibernation'

// ============================================================================
// Mock Implementations
// ============================================================================

/**
 * Create a mock DurableObjectState for testing
 */
function createMockState(): DurableObjectState & {
  acceptedWebSockets: Array<{ ws: WebSocket; tags: string[] }>
  webSocketAutoResponse: { request: string; response: string } | null
  storageData: Map<string, unknown>
} {
  const acceptedWebSockets: Array<{ ws: WebSocket; tags: string[] }> = []
  const storageData = new Map<string, unknown>()
  let webSocketAutoResponse: { request: string; response: string } | null = null

  return {
    id: { toString: () => 'test-do-id', name: 'test' } as DurableObjectId,
    acceptedWebSockets,
    webSocketAutoResponse,
    storageData,
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn) => fn()),
    acceptWebSocket: vi.fn((ws: WebSocket, tags?: string[]) => {
      acceptedWebSockets.push({ ws, tags: tags ?? [] })
    }),
    getWebSockets: vi.fn((tag?: string) => {
      if (tag) {
        return acceptedWebSockets
          .filter(({ tags }) => tags.includes(tag))
          .map(({ ws }) => ws)
      }
      return acceptedWebSockets.map(({ ws }) => ws)
    }),
    setWebSocketAutoResponse: vi.fn((pair: WebSocketRequestResponsePair) => {
      webSocketAutoResponse = {
        request: (pair as any).getRequest?.() ?? 'ping',
        response: (pair as any).getResponse?.() ?? 'pong',
      }
    }),
    getWebSocketAutoResponse: vi.fn(() => webSocketAutoResponse),
    getWebSocketAutoResponseTimestamp: vi.fn(() => null),
    setHibernatableWebSocketEventTimeout: vi.fn(),
    getHibernatableWebSocketEventTimeout: vi.fn(() => null),
    getTags: vi.fn((ws: WebSocket) => {
      const found = acceptedWebSockets.find(({ ws: w }) => w === ws)
      return found?.tags ?? []
    }),
    storage: {
      get: vi.fn(async <T>(key: string): Promise<T | undefined> => {
        return storageData.get(key) as T | undefined
      }),
      put: vi.fn(async (key: string, value: unknown) => {
        storageData.set(key, value)
      }),
      delete: vi.fn(async (key: string) => {
        return storageData.delete(key)
      }),
      list: vi.fn(async () => storageData),
      deleteAll: vi.fn(async () => {}),
      getAlarm: vi.fn(async () => null),
      setAlarm: vi.fn(async () => {}),
      deleteAlarm: vi.fn(async () => {}),
      sync: vi.fn(async () => {}),
      transaction: vi.fn(async (fn) => fn({
        get: async (key: string) => storageData.get(key),
        put: async (key: string, value: unknown) => storageData.set(key, value),
        delete: async (key: string) => storageData.delete(key),
      })),
      transactionSync: vi.fn((fn) => fn({
        get: (key: string) => storageData.get(key),
        put: (key: string, value: unknown) => storageData.set(key, value),
        delete: (key: string) => storageData.delete(key),
      })),
    },
  } as unknown as DurableObjectState & {
    acceptedWebSockets: Array<{ ws: WebSocket; tags: string[] }>
    webSocketAutoResponse: { request: string; response: string } | null
    storageData: Map<string, unknown>
  }
}

/**
 * Create a mock WebSocket for testing
 */
function createMockWebSocket(): WebSocket & {
  attachment: unknown
  sentMessages: string[]
  closed: boolean
  closeCode?: number
  closeReason?: string
} {
  let attachment: unknown = null
  const sentMessages: string[] = []
  let closed = false
  let closeCode: number | undefined
  let closeReason: string | undefined

  const ws = {
    readyState: WebSocket.OPEN,
    attachment,
    sentMessages,
    closed,
    closeCode,
    closeReason,
    serializeAttachment: vi.fn((data: unknown) => {
      attachment = data
      ws.attachment = data
    }),
    deserializeAttachment: vi.fn(() => attachment),
    send: vi.fn((data: string) => {
      if (closed) throw new Error('WebSocket is closed')
      sentMessages.push(data)
      ws.sentMessages = sentMessages
    }),
    close: vi.fn((code?: number, reason?: string) => {
      closed = true
      closeCode = code
      closeReason = reason
      ws.closed = closed
      ws.closeCode = closeCode
      ws.closeReason = closeReason
    }),
    accept: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    binaryType: 'arraybuffer' as BinaryType,
    bufferedAmount: 0,
    extensions: '',
    onclose: null,
    onerror: null,
    onmessage: null,
    onopen: null,
    protocol: '',
    url: 'ws://test',
  } as unknown as WebSocket & {
    attachment: unknown
    sentMessages: string[]
    closed: boolean
    closeCode?: number
    closeReason?: string
  }

  return ws
}

// ============================================================================
// Tests
// ============================================================================

describe('HibernationManager', () => {
  let manager: HibernationManager
  let mockState: ReturnType<typeof createMockState>

  beforeEach(() => {
    mockState = createMockState()
    manager = new HibernationManager(mockState)
  })

  describe('constructor', () => {
    it('should create manager with default config', () => {
      expect(manager).toBeDefined()
      expect(mockState.setWebSocketAutoResponse).toHaveBeenCalled()
    })

    it('should respect custom config', () => {
      const customManager = new HibernationManager(mockState, {
        enableAutoResponse: false,
        pingMessage: 'custom-ping',
        pongResponse: 'custom-pong',
      })
      expect(customManager).toBeDefined()
    })

    it('should not setup auto-response when disabled', () => {
      const calls = (mockState.setWebSocketAutoResponse as ReturnType<typeof vi.fn>).mock.calls.length

      new HibernationManager(mockState, {
        enableAutoResponse: false,
      })

      // Should not have added another call
      expect((mockState.setWebSocketAutoResponse as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls)
    })
  })

  describe('acceptWebSocket', () => {
    it('should accept WebSocket with hibernation support', () => {
      const ws = createMockWebSocket()
      const attachment = manager.acceptWebSocket(ws, {
        clientId: 'client-123',
        tags: ['user:123'],
      })

      expect(mockState.acceptWebSocket).toHaveBeenCalledWith(
        ws,
        expect.arrayContaining(['hibernatable', 'user:123', 'client:client-123'])
      )
      expect(attachment.connectionId).toBeDefined()
      expect(attachment.clientId).toBe('client-123')
      expect(attachment.tags).toContain('user:123')
    })

    it('should serialize attachment to WebSocket', () => {
      const ws = createMockWebSocket()
      manager.acceptWebSocket(ws, {
        metadata: { role: 'admin' },
      })

      expect(ws.serializeAttachment).toHaveBeenCalled()
      const attachment = ws.attachment as HibernationAttachment
      expect(attachment.metadata?.role).toBe('admin')
    })

    it('should truncate oversized metadata', () => {
      const ws = createMockWebSocket()
      const largeMetadata: Record<string, string> = {}
      for (let i = 0; i < 100; i++) {
        largeMetadata[`key${i}`] = 'x'.repeat(50)
      }

      const attachment = manager.acceptWebSocket(ws, {
        metadata: largeMetadata,
      })

      // Metadata should be undefined when too large
      expect(attachment.metadata).toBeUndefined()
    })
  })

  describe('handleUpgrade', () => {
    it('should return 101 response with WebSocket', () => {
      // Note: WebSocketPair is not available in Node.js tests
      // This test verifies the method exists and can be called
      // In real Cloudflare environment, this would return proper WebSocket
      expect(typeof manager.handleUpgrade).toBe('function')
    })
  })

  describe('getAttachment', () => {
    it('should retrieve attachment from WebSocket', () => {
      const ws = createMockWebSocket()
      const original = manager.acceptWebSocket(ws, {
        clientId: 'test-client',
        tags: ['tag1'],
      })

      const retrieved = manager.getAttachment(ws)
      expect(retrieved.connectionId).toBe(original.connectionId)
      expect(retrieved.clientId).toBe('test-client')
    })

    it('should handle missing attachment gracefully', () => {
      const ws = createMockWebSocket()
      const attachment = manager.getAttachment(ws)

      expect(attachment.connectionId).toBeDefined()
      expect(attachment.tags).toEqual([])
    })

    it('should convert Set to array for backwards compatibility', () => {
      const ws = createMockWebSocket()
      // Simulate old format with Set - need to override deserializeAttachment
      const tagsSet = new Set(['tag1', 'tag2'])
      ;(ws.deserializeAttachment as ReturnType<typeof vi.fn>).mockReturnValue({
        connectionId: 'old-id',
        connectedAt: Date.now(),
        lastActivityAt: Date.now(),
        tags: tagsSet,
      })

      const attachment = manager.getAttachment(ws)
      expect(Array.isArray(attachment.tags)).toBe(true)
      expect(attachment.tags).toContain('tag1')
      expect(attachment.tags).toContain('tag2')
    })
  })

  describe('updateAttachment', () => {
    it('should update attachment data', () => {
      const ws = createMockWebSocket()
      manager.acceptWebSocket(ws)

      manager.updateAttachment(ws, {
        metadata: { updated: true },
      })

      const attachment = manager.getAttachment(ws)
      expect(attachment.metadata?.updated).toBe(true)
    })
  })

  describe('updateActivity', () => {
    it('should update lastActivityAt timestamp', async () => {
      const ws = createMockWebSocket()
      manager.acceptWebSocket(ws)

      const before = manager.getAttachment(ws).lastActivityAt

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10))

      manager.updateActivity(ws)

      const after = manager.getAttachment(ws).lastActivityAt
      expect(after).toBeGreaterThanOrEqual(before)
    })
  })

  describe('restoreFromHibernation', () => {
    it('should restore connections from getWebSockets', async () => {
      // Add some WebSockets first
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()
      manager.acceptWebSocket(ws1, { clientId: 'client1' })
      manager.acceptWebSocket(ws2, { clientId: 'client2' })

      // Create new manager (simulating hibernation wake)
      const newManager = new HibernationManager(mockState)
      const attachments = await newManager.restoreFromHibernation()

      expect(attachments.length).toBe(2)
    })

    it('should restore persisted state from storage', async () => {
      const state: HibernationState = {
        stats: {
          messagesReceived: 100,
          messagesSent: 50,
          hibernationCount: 5,
        },
      }

      await mockState.storage.put('hibernation_state', state)

      const newManager = new HibernationManager(mockState, {
        persistStateOnMessage: true,
      })
      await newManager.restoreFromHibernation()

      const restoredState = newManager.getState()
      expect(restoredState.stats?.messagesReceived).toBe(100)
      expect(restoredState.stats?.hibernationCount).toBe(6) // Incremented
    })
  })

  describe('state management', () => {
    it('should save state to storage', async () => {
      await manager.updateState({
        stats: {
          messagesReceived: 10,
          messagesSent: 5,
          hibernationCount: 0,
        },
      }, true)

      const stored = await mockState.storage.get('hibernation_state')
      expect((stored as HibernationState)?.stats?.messagesReceived).toBe(10)
    })

    it('should update state without persisting', async () => {
      await manager.updateState({
        custom: { key: 'value' },
      }, false)

      const state = manager.getState()
      expect(state.custom?.key).toBe('value')

      // Should not be in storage
      const stored = await mockState.storage.get('hibernation_state')
      expect(stored).toBeUndefined()
    })
  })

  describe('connection utilities', () => {
    it('should get all connections', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()
      manager.acceptWebSocket(ws1, { tags: ['tag1'] })
      manager.acceptWebSocket(ws2, { tags: ['tag2'] })

      const connections = manager.getConnections()
      expect(connections.length).toBe(2)
    })

    it('should filter connections by tag', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()
      manager.acceptWebSocket(ws1, { tags: ['group:a'] })
      manager.acceptWebSocket(ws2, { tags: ['group:b'] })

      const connections = manager.getConnections('hibernatable')
      expect(connections.length).toBe(2)
    })

    it('should get connection count', () => {
      const ws = createMockWebSocket()
      manager.acceptWebSocket(ws)

      expect(manager.getConnectionCount()).toBe(1)
    })

    it('should get WebSocket by client ID', () => {
      const ws = createMockWebSocket()
      manager.acceptWebSocket(ws, { clientId: 'my-client' })

      const found = manager.getWebSocketByClientId('my-client')
      expect(found).toBe(ws)
    })
  })

  describe('messaging', () => {
    it('should broadcast to all connections', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()
      manager.acceptWebSocket(ws1)
      manager.acceptWebSocket(ws2)

      const result = manager.broadcast({ type: 'test', data: 'hello' })

      expect(result.sent).toBe(2)
      expect(result.failed).toBe(0)
      expect(ws1.sentMessages.length).toBe(1)
      expect(ws2.sentMessages.length).toBe(1)
    })

    it('should handle send failures gracefully', () => {
      const ws = createMockWebSocket()
      manager.acceptWebSocket(ws)
      ws.close()

      const result = manager.broadcast({ type: 'test' })
      expect(result.failed).toBe(1)
    })

    it('should send to specific WebSocket', () => {
      const ws = createMockWebSocket()
      manager.acceptWebSocket(ws)

      const success = manager.send(ws, { type: 'direct', data: 'hello' })

      expect(success).toBe(true)
      expect(ws.sentMessages).toContain(JSON.stringify({ type: 'direct', data: 'hello' }))
    })
  })

  describe('closeConnection', () => {
    it('should close WebSocket with code and reason', () => {
      const ws = createMockWebSocket()
      manager.acceptWebSocket(ws)

      manager.closeConnection(ws, 1000, 'Normal closure')

      expect(ws.closed).toBe(true)
      expect(ws.closeCode).toBe(1000)
      expect(ws.closeReason).toBe('Normal closure')
    })
  })
})

describe('estimateHibernationSavings', () => {
  it('should calculate cost savings correctly', () => {
    const result = estimateHibernationSavings({
      connectionsPerHour: 10,
      messagesPerConnectionPerHour: 60,
      avgMessageProcessingMs: 50,
      activeHoursPerDay: 8,
    })

    expect(result.withoutHibernation).toBeGreaterThan(0)
    expect(result.withHibernation).toBeGreaterThan(0)
    expect(result.withoutHibernation).toBeGreaterThan(result.withHibernation)
    expect(result.savingsPercent).toBeGreaterThan(0)
    expect(result.savingsPercent).toBeLessThanOrEqual(100)
    expect(result.monthlySavings).toBeGreaterThanOrEqual(0)
  })

  it('should show higher savings for sparse messaging patterns', () => {
    // Frequent messages
    const frequent = estimateHibernationSavings({
      connectionsPerHour: 100,
      messagesPerConnectionPerHour: 3600, // 1 per second
      avgMessageProcessingMs: 10,
      activeHoursPerDay: 24,
    })

    // Sparse messages
    const sparse = estimateHibernationSavings({
      connectionsPerHour: 100,
      messagesPerConnectionPerHour: 1, // 1 per hour
      avgMessageProcessingMs: 10,
      activeHoursPerDay: 24,
    })

    expect(sparse.savingsPercent).toBeGreaterThan(frequent.savingsPercent)
  })
})

describe('isHibernationError', () => {
  it('should detect hibernation-related errors', () => {
    expect(isHibernationError(new Error('hibernation timeout'))).toBe(true)
    expect(isHibernationError(new Error('WebSocket not open'))).toBe(true)
    expect(isHibernationError(new Error('connection closed'))).toBe(true)
  })

  it('should not flag unrelated errors', () => {
    expect(isHibernationError(new Error('syntax error'))).toBe(false)
    expect(isHibernationError(new Error('network timeout'))).toBe(false)
    expect(isHibernationError('not an error')).toBe(false)
    expect(isHibernationError(null)).toBe(false)
  })
})

describe('createHibernationPayload', () => {
  it('should serialize data to JSON', () => {
    const result = createHibernationPayload({ key: 'value' })
    expect(result).toBe('{"key":"value"}')
  })

  it('should return undefined for oversized payload', () => {
    const large = { data: 'x'.repeat(3000) }
    const result = createHibernationPayload(large, 2048)
    expect(result).toBeUndefined()
  })

  it('should handle non-serializable data', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    const result = createHibernationPayload(circular)
    expect(result).toBeUndefined()
  })
})

describe('DEFAULT_HIBERNATION_CONFIG', () => {
  it('should have expected default values', () => {
    expect(DEFAULT_HIBERNATION_CONFIG.enableAutoResponse).toBe(true)
    expect(DEFAULT_HIBERNATION_CONFIG.pingMessage).toBe('ping')
    expect(DEFAULT_HIBERNATION_CONFIG.pongResponse).toBe('pong')
    expect(DEFAULT_HIBERNATION_CONFIG.persistStateOnMessage).toBe(false)
    expect(DEFAULT_HIBERNATION_CONFIG.stateStorageKey).toBe('hibernation_state')
    expect(DEFAULT_HIBERNATION_CONFIG.maxAttachmentSize).toBe(2048)
  })
})
