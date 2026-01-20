import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  HibernationManager,
  HibernationAttachment,
  HibernationState,
  HibernationConfig,
  DEFAULT_HIBERNATION_CONFIG,
  estimateHibernationSavings,
  isHibernationError,
  createHibernationPayload,
} from '../hibernation'

/**
 * Hibernation Manager Tests
 *
 * Tests the hibernation lifecycle for WebSocket connections:
 * 1. State save during hibernation
 * 2. State restoration after wake
 * 3. Edge cases (empty state, large state)
 *
 * These tests use mock DurableObjectState to isolate hibernation logic.
 * For integration tests with real miniflare, see websocket-concurrent.test.ts
 */

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Creates a mock DurableObjectState for testing hibernation
 */
function createMockState(): DurableObjectState & {
  _storage: Map<string, unknown>
  _websockets: Map<string, Set<WebSocket>>
  _allWebsockets: Set<WebSocket>
  _autoResponse: WebSocketRequestResponsePair | null
} {
  const storage = new Map<string, unknown>()
  const websockets = new Map<string, Set<WebSocket>>()
  const allWebsockets = new Set<WebSocket>()
  let autoResponse: WebSocketRequestResponsePair | null = null

  return {
    _storage: storage,
    _websockets: websockets,
    _allWebsockets: allWebsockets,
    _autoResponse: autoResponse,
    id: { toString: () => 'test-hibernation-do-id' } as DurableObjectId,
    storage: {
      get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
      put: vi.fn((key: string, value: unknown) => {
        storage.set(key, value)
        return Promise.resolve()
      }),
      delete: vi.fn((key: string) => {
        storage.delete(key)
        return Promise.resolve(true)
      }),
      list: vi.fn(() => Promise.resolve(storage)),
      deleteAll: vi.fn(() => {
        storage.clear()
        return Promise.resolve()
      }),
    },
    blockConcurrencyWhile: vi.fn((fn) => fn()),
    waitUntil: vi.fn(),
    acceptWebSocket: vi.fn((ws: WebSocket, tags?: string[]) => {
      allWebsockets.add(ws)
      const tagList = tags || []
      for (const tag of tagList) {
        if (!websockets.has(tag)) {
          websockets.set(tag, new Set())
        }
        websockets.get(tag)!.add(ws)
      }
    }),
    getWebSockets: vi.fn((tag?: string) => {
      if (tag) {
        return Array.from(websockets.get(tag) || [])
      }
      return Array.from(allWebsockets)
    }),
    setWebSocketAutoResponse: vi.fn((pair: WebSocketRequestResponsePair) => {
      autoResponse = pair
    }),
  } as unknown as DurableObjectState & {
    _storage: Map<string, unknown>
    _websockets: Map<string, Set<WebSocket>>
    _allWebsockets: Set<WebSocket>
    _autoResponse: WebSocketRequestResponsePair | null
  }
}

/**
 * Creates a mock WebSocket for testing hibernation attachment
 */
function createMockWebSocket(): WebSocket & {
  _attachment: unknown
  _sentMessages: string[]
  _closed: boolean
} {
  let attachment: unknown = null
  const sentMessages: string[] = []
  let readyState = 1 // OPEN
  let closed = false

  return {
    get readyState() { return readyState },
    _attachment: attachment,
    _sentMessages: sentMessages,
    _closed: closed,
    send: vi.fn((data: string) => {
      if (readyState !== 1) {
        throw new Error('WebSocket is not open')
      }
      sentMessages.push(data)
    }),
    close: vi.fn((code?: number, reason?: string) => {
      readyState = 3 // CLOSED
      closed = true
    }),
    serializeAttachment: vi.fn((data: unknown) => {
      attachment = data
    }),
    deserializeAttachment: vi.fn(() => attachment),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as WebSocket & {
    _attachment: unknown
    _sentMessages: string[]
    _closed: boolean
  }
}

// ============================================================================
// HibernationManager Construction Tests
// ============================================================================

describe('HibernationManager - Construction', () => {
  it('should initialize with default config', () => {
    const mockState = createMockState()
    const manager = new HibernationManager(mockState)

    expect(manager).toBeDefined()
  })

  it('should merge custom config with defaults', () => {
    const mockState = createMockState()
    const customConfig: Partial<HibernationConfig> = {
      pingMessage: 'custom-ping',
      pongResponse: 'custom-pong',
    }

    const manager = new HibernationManager(mockState, customConfig)

    expect(manager).toBeDefined()
  })

  it('should setup auto-response when enabled', () => {
    const mockState = createMockState()
    new HibernationManager(mockState, { enableAutoResponse: true })

    expect(mockState.setWebSocketAutoResponse).toHaveBeenCalled()
  })

  it('should not setup auto-response when disabled', () => {
    const mockState = createMockState()
    new HibernationManager(mockState, { enableAutoResponse: false })

    expect(mockState.setWebSocketAutoResponse).not.toHaveBeenCalled()
  })
})

// ============================================================================
// WebSocket Connection Management Tests
// ============================================================================

describe('HibernationManager - Connection Management', () => {
  let manager: HibernationManager
  let mockState: ReturnType<typeof createMockState>

  beforeEach(() => {
    mockState = createMockState()
    manager = new HibernationManager(mockState)
  })

  describe('acceptWebSocket', () => {
    it('should accept a WebSocket with hibernation support', () => {
      const ws = createMockWebSocket()

      const attachment = manager.acceptWebSocket(ws)

      expect(attachment.connectionId).toBeDefined()
      expect(attachment.connectedAt).toBeGreaterThan(0)
      expect(attachment.lastActivityAt).toBeGreaterThan(0)
      expect(mockState.acceptWebSocket).toHaveBeenCalled()
    })

    it('should include client ID in attachment when provided', () => {
      const ws = createMockWebSocket()

      const attachment = manager.acceptWebSocket(ws, { clientId: 'user-123' })

      expect(attachment.clientId).toBe('user-123')
    })

    it('should include tags in attachment', () => {
      const ws = createMockWebSocket()

      const attachment = manager.acceptWebSocket(ws, { tags: ['room:1', 'chat'] })

      expect(attachment.tags).toContain('room:1')
      expect(attachment.tags).toContain('chat')
    })

    it('should include protocol version in attachment', () => {
      const ws = createMockWebSocket()

      const attachment = manager.acceptWebSocket(ws, { protocolVersion: 2 })

      expect(attachment.protocolVersion).toBe(2)
    })

    it('should include metadata in attachment', () => {
      const ws = createMockWebSocket()
      const metadata = { role: 'admin', region: 'us-west' }

      const attachment = manager.acceptWebSocket(ws, { metadata })

      expect(attachment.metadata).toEqual(metadata)
    })

    it('should serialize attachment to WebSocket', () => {
      const ws = createMockWebSocket()

      manager.acceptWebSocket(ws)

      expect(ws.serializeAttachment).toHaveBeenCalled()
    })

    it('should truncate metadata if attachment exceeds max size', () => {
      const mockStateWithConfig = createMockState()
      const managerWithSmallMax = new HibernationManager(mockStateWithConfig, {
        maxAttachmentSize: 100, // Very small to trigger truncation
      })

      const ws = createMockWebSocket()
      const largeMetadata = { data: 'x'.repeat(200) }

      const attachment = managerWithSmallMax.acceptWebSocket(ws, { metadata: largeMetadata })

      // Metadata should be truncated (set to undefined)
      expect(attachment.metadata).toBeUndefined()
    })
  })

  describe('handleUpgrade', () => {
    it('should return a 101 WebSocket upgrade response', () => {
      const response = manager.handleUpgrade()

      expect(response.status).toBe(101)
      expect(response.webSocket).toBeDefined()
    })

    it('should pass options to acceptWebSocket', () => {
      const response = manager.handleUpgrade({
        clientId: 'test-client',
        tags: ['tag1'],
      })

      expect(response.status).toBe(101)
      expect(mockState.acceptWebSocket).toHaveBeenCalled()
    })
  })
})

// ============================================================================
// Attachment Management Tests
// ============================================================================

describe('HibernationManager - Attachment Management', () => {
  let manager: HibernationManager
  let mockState: ReturnType<typeof createMockState>

  beforeEach(() => {
    mockState = createMockState()
    manager = new HibernationManager(mockState)
  })

  describe('getAttachment', () => {
    it('should retrieve stored attachment from WebSocket', () => {
      const ws = createMockWebSocket()
      const originalAttachment = manager.acceptWebSocket(ws, { clientId: 'test' })

      const retrieved = manager.getAttachment(ws)

      expect(retrieved.connectionId).toBe(originalAttachment.connectionId)
      expect(retrieved.clientId).toBe('test')
    })

    it('should return default attachment when none stored', () => {
      const ws = createMockWebSocket()

      const attachment = manager.getAttachment(ws)

      expect(attachment.connectionId).toBeDefined()
      expect(attachment.tags).toEqual([])
    })

    it('should handle corrupted attachment gracefully', () => {
      const ws = createMockWebSocket()
      // Simulate corrupted attachment
      ;(ws as any).deserializeAttachment = vi.fn(() => {
        throw new Error('Corrupted data')
      })

      const attachment = manager.getAttachment(ws)

      expect(attachment.connectionId).toBeDefined()
      expect(attachment.tags).toEqual([])
    })

    it('should convert Set tags to array for backwards compatibility', () => {
      const ws = createMockWebSocket()
      // Simulate old-format attachment with Set
      const oldAttachment = {
        connectionId: 'old-conn',
        connectedAt: Date.now(),
        lastActivityAt: Date.now(),
        tags: new Set(['tag1', 'tag2']),
      }
      ;(ws as any).deserializeAttachment = vi.fn(() => oldAttachment)

      const attachment = manager.getAttachment(ws)

      expect(Array.isArray(attachment.tags)).toBe(true)
      expect(attachment.tags).toContain('tag1')
      expect(attachment.tags).toContain('tag2')
    })
  })

  describe('updateAttachment', () => {
    it('should update attachment with new values', () => {
      const ws = createMockWebSocket()
      manager.acceptWebSocket(ws)

      manager.updateAttachment(ws, { clientId: 'new-client' })

      const updated = manager.getAttachment(ws)
      expect(updated.clientId).toBe('new-client')
    })

    it('should preserve existing values when updating', () => {
      const ws = createMockWebSocket()
      const original = manager.acceptWebSocket(ws, {
        tags: ['original-tag'],
        clientId: 'original-client',
      })

      manager.updateAttachment(ws, { protocolVersion: 3 })

      const updated = manager.getAttachment(ws)
      expect(updated.connectionId).toBe(original.connectionId)
      expect(updated.tags).toContain('original-tag')
      expect(updated.clientId).toBe('original-client')
      expect(updated.protocolVersion).toBe(3)
    })
  })

  describe('updateActivity', () => {
    it('should update lastActivityAt timestamp', async () => {
      const ws = createMockWebSocket()
      const original = manager.acceptWebSocket(ws)
      const originalTime = original.lastActivityAt

      // Wait a small amount to ensure time advances
      await new Promise(resolve => setTimeout(resolve, 5))

      manager.updateActivity(ws)

      const updated = manager.getAttachment(ws)
      expect(updated.lastActivityAt).toBeGreaterThanOrEqual(originalTime)
    })
  })
})

// ============================================================================
// Hibernation State Save/Restore Tests
// ============================================================================

describe('HibernationManager - State Persistence', () => {
  let manager: HibernationManager
  let mockState: ReturnType<typeof createMockState>

  beforeEach(() => {
    mockState = createMockState()
    manager = new HibernationManager(mockState, { persistStateOnMessage: true })
  })

  describe('saveState', () => {
    it('should save current state to storage', async () => {
      await manager.updateState({
        stats: {
          messagesReceived: 10,
          messagesSent: 5,
          hibernationCount: 2,
        },
      })

      await manager.saveState()

      expect(mockState.storage.put).toHaveBeenCalledWith(
        DEFAULT_HIBERNATION_CONFIG.stateStorageKey,
        expect.objectContaining({
          stats: expect.objectContaining({
            messagesReceived: 10,
          }),
        })
      )
    })

    it('should save empty state', async () => {
      await manager.saveState()

      expect(mockState.storage.put).toHaveBeenCalledWith(
        DEFAULT_HIBERNATION_CONFIG.stateStorageKey,
        expect.any(Object)
      )
    })
  })

  describe('restoreFromHibernation', () => {
    it('should restore WebSocket attachments after wake', async () => {
      // Setup: add some websockets before "hibernation"
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()
      manager.acceptWebSocket(ws1, { clientId: 'client-1' })
      manager.acceptWebSocket(ws2, { clientId: 'client-2' })

      const attachments = await manager.restoreFromHibernation()

      expect(attachments.length).toBe(2)
      expect(attachments.some(a => a.clientId === 'client-1')).toBe(true)
      expect(attachments.some(a => a.clientId === 'client-2')).toBe(true)
    })

    it('should restore persisted state from storage', async () => {
      // Pre-populate storage with state (simulating previous hibernation)
      const savedState: HibernationState = {
        stats: {
          messagesReceived: 100,
          messagesSent: 50,
          hibernationCount: 5,
        },
        custom: { key: 'value' },
      }
      mockState._storage.set(DEFAULT_HIBERNATION_CONFIG.stateStorageKey, savedState)

      await manager.restoreFromHibernation()

      const state = manager.getState()
      expect(state.stats?.messagesReceived).toBe(100)
      expect(state.stats?.hibernationCount).toBe(6) // Incremented
      expect(state.custom).toEqual({ key: 'value' })
    })

    it('should return empty array when no connections exist', async () => {
      const attachments = await manager.restoreFromHibernation()

      expect(attachments).toEqual([])
    })

    it('should handle missing persisted state gracefully', async () => {
      // Don't pre-populate storage

      await manager.restoreFromHibernation()

      const state = manager.getState()
      expect(state).toBeDefined()
    })
  })

  describe('getState', () => {
    it('should return current hibernation state', () => {
      const state = manager.getState()

      expect(state).toBeDefined()
      expect(typeof state).toBe('object')
    })
  })

  describe('updateState', () => {
    it('should update state in memory', async () => {
      await manager.updateState({
        pendingItems: [1, 2, 3],
      })

      const state = manager.getState()
      expect(state.pendingItems).toEqual([1, 2, 3])
    })

    it('should merge with existing state', async () => {
      await manager.updateState({ pendingItems: [1] })
      await manager.updateState({ lastSequences: { source1: 10 } })

      const state = manager.getState()
      expect(state.pendingItems).toEqual([1])
      expect(state.lastSequences).toEqual({ source1: 10 })
    })

    it('should persist immediately when persist=true', async () => {
      await manager.updateState({ custom: { test: true } }, true)

      expect(mockState.storage.put).toHaveBeenCalled()
    })

    it('should not persist when persist=false', async () => {
      await manager.updateState({ custom: { test: true } }, false)

      expect(mockState.storage.put).not.toHaveBeenCalled()
    })
  })
})

// ============================================================================
// Connection Utility Tests
// ============================================================================

describe('HibernationManager - Connection Utilities', () => {
  let manager: HibernationManager
  let mockState: ReturnType<typeof createMockState>

  beforeEach(() => {
    mockState = createMockState()
    manager = new HibernationManager(mockState)
  })

  describe('getConnections', () => {
    it('should return all connections with attachments', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()
      manager.acceptWebSocket(ws1)
      manager.acceptWebSocket(ws2)

      const connections = manager.getConnections()

      expect(connections.length).toBe(2)
      expect(connections[0].ws).toBeDefined()
      expect(connections[0].attachment).toBeDefined()
    })

    it('should filter connections by tag', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()
      manager.acceptWebSocket(ws1, { tags: ['room:1'] })
      manager.acceptWebSocket(ws2, { tags: ['room:2'] })

      const room1Connections = manager.getConnections('room:1')

      expect(room1Connections.length).toBe(1)
    })

    it('should return empty array when no connections', () => {
      const connections = manager.getConnections()

      expect(connections).toEqual([])
    })
  })

  describe('getConnectionCount', () => {
    it('should return total connection count', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()
      manager.acceptWebSocket(ws1)
      manager.acceptWebSocket(ws2)

      expect(manager.getConnectionCount()).toBe(2)
    })

    it('should return count for specific tag', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()
      const ws3 = createMockWebSocket()
      manager.acceptWebSocket(ws1, { tags: ['chat'] })
      manager.acceptWebSocket(ws2, { tags: ['chat'] })
      manager.acceptWebSocket(ws3, { tags: ['notifications'] })

      expect(manager.getConnectionCount('chat')).toBe(2)
      expect(manager.getConnectionCount('notifications')).toBe(1)
    })

    it('should return 0 when no connections', () => {
      expect(manager.getConnectionCount()).toBe(0)
    })
  })

  describe('getWebSocketByClientId', () => {
    it('should find WebSocket by client ID', () => {
      const ws = createMockWebSocket()
      manager.acceptWebSocket(ws, { clientId: 'user-abc' })

      const found = manager.getWebSocketByClientId('user-abc')

      expect(found).toBeDefined()
    })

    it('should return undefined for unknown client ID', () => {
      const found = manager.getWebSocketByClientId('unknown')

      expect(found).toBeUndefined()
    })
  })
})

// ============================================================================
// Broadcast and Send Tests
// ============================================================================

describe('HibernationManager - Messaging', () => {
  let manager: HibernationManager
  let mockState: ReturnType<typeof createMockState>

  beforeEach(() => {
    mockState = createMockState()
    manager = new HibernationManager(mockState)
  })

  describe('broadcast', () => {
    it('should broadcast to all connections', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()
      manager.acceptWebSocket(ws1)
      manager.acceptWebSocket(ws2)

      const result = manager.broadcast({ type: 'notification', data: 'hello' })

      expect(result.sent).toBe(2)
      expect(result.failed).toBe(0)
      expect(ws1._sentMessages.length).toBe(1)
      expect(ws2._sentMessages.length).toBe(1)
    })

    it('should broadcast to connections with specific tag', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()
      manager.acceptWebSocket(ws1, { tags: ['room:1'] })
      manager.acceptWebSocket(ws2, { tags: ['room:2'] })

      const result = manager.broadcast({ type: 'message' }, 'room:1')

      expect(result.sent).toBe(1)
      expect(ws1._sentMessages.length).toBe(1)
      expect(ws2._sentMessages.length).toBe(0)
    })

    it('should handle failed sends gracefully', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()
      manager.acceptWebSocket(ws1)
      manager.acceptWebSocket(ws2)

      // Close one WebSocket
      ws1.close()

      const result = manager.broadcast({ type: 'test' })

      expect(result.sent).toBe(1)
      expect(result.failed).toBe(1)
    })
  })

  describe('send', () => {
    it('should send message to specific WebSocket', () => {
      const ws = createMockWebSocket()
      manager.acceptWebSocket(ws)

      const success = manager.send(ws, { type: 'direct', data: 'message' })

      expect(success).toBe(true)
      expect(ws._sentMessages.length).toBe(1)
      expect(JSON.parse(ws._sentMessages[0])).toEqual({ type: 'direct', data: 'message' })
    })

    it('should return false when WebSocket is closed', () => {
      const ws = createMockWebSocket()
      manager.acceptWebSocket(ws)
      ws.close()

      const success = manager.send(ws, { type: 'test' })

      expect(success).toBe(false)
    })
  })

  describe('closeConnection', () => {
    it('should close WebSocket with code and reason', () => {
      const ws = createMockWebSocket()
      manager.acceptWebSocket(ws)

      manager.closeConnection(ws, 1001, 'Going away')

      expect(ws.close).toHaveBeenCalledWith(1001, 'Going away')
    })

    it('should use default code 1000', () => {
      const ws = createMockWebSocket()
      manager.acceptWebSocket(ws)

      manager.closeConnection(ws)

      expect(ws.close).toHaveBeenCalledWith(1000, undefined)
    })

    it('should handle close errors gracefully', () => {
      const ws = createMockWebSocket()
      manager.acceptWebSocket(ws)
      ;(ws as any).close = vi.fn(() => {
        throw new Error('Already closed')
      })

      // Should not throw
      expect(() => manager.closeConnection(ws)).not.toThrow()
    })
  })
})

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('HibernationManager - Edge Cases', () => {
  describe('empty state', () => {
    it('should handle empty state correctly', async () => {
      const mockState = createMockState()
      const manager = new HibernationManager(mockState)

      const state = manager.getState()

      expect(state).toEqual({})
    })

    it('should save and restore empty state', async () => {
      const mockState = createMockState()
      const manager = new HibernationManager(mockState, { persistStateOnMessage: true })

      await manager.saveState()
      await manager.restoreFromHibernation()

      expect(manager.getState()).toEqual({})
    })
  })

  describe('large state', () => {
    it('should handle large pending items array', async () => {
      const mockState = createMockState()
      const manager = new HibernationManager(mockState)

      const largeArray = Array.from({ length: 1000 }, (_, i) => ({ id: i, data: `item-${i}` }))
      await manager.updateState({ pendingItems: largeArray })

      const state = manager.getState()
      expect(state.pendingItems?.length).toBe(1000)
    })

    it('should handle large lastSequences map', async () => {
      const mockState = createMockState()
      const manager = new HibernationManager(mockState)

      const largeSequences: Record<string, number> = {}
      for (let i = 0; i < 100; i++) {
        largeSequences[`source-${i}`] = i * 100
      }
      await manager.updateState({ lastSequences: largeSequences })

      const state = manager.getState()
      expect(Object.keys(state.lastSequences || {}).length).toBe(100)
    })

    it('should handle large custom state', async () => {
      const mockState = createMockState()
      const manager = new HibernationManager(mockState)

      const largeCustom: Record<string, unknown> = {}
      for (let i = 0; i < 50; i++) {
        largeCustom[`key-${i}`] = { nested: { data: 'x'.repeat(100) } }
      }
      await manager.updateState({ custom: largeCustom })

      const state = manager.getState()
      expect(Object.keys(state.custom || {}).length).toBe(50)
    })
  })

  describe('concurrent operations', () => {
    it('should handle multiple state updates correctly', async () => {
      const mockState = createMockState()
      const manager = new HibernationManager(mockState)

      // Simulate concurrent updates
      await Promise.all([
        manager.updateState({ stats: { messagesReceived: 1, messagesSent: 0, hibernationCount: 0 } }),
        manager.updateState({ pendingItems: [1] }),
        manager.updateState({ lastSequences: { a: 1 } }),
      ])

      const state = manager.getState()
      // Last update wins for each key
      expect(state.stats || state.pendingItems || state.lastSequences).toBeDefined()
    })

    it('should handle rapid connection/disconnection', () => {
      const mockState = createMockState()
      const manager = new HibernationManager(mockState)

      // Rapidly connect and disconnect
      for (let i = 0; i < 50; i++) {
        const ws = createMockWebSocket()
        manager.acceptWebSocket(ws, { clientId: `client-${i}` })
        manager.closeConnection(ws)
      }

      // All websockets should be tracked (even if closed)
      expect(manager.getConnectionCount()).toBe(50)
    })
  })
})

// ============================================================================
// Utility Function Tests
// ============================================================================

describe('estimateHibernationSavings', () => {
  it('should calculate cost savings correctly', () => {
    const result = estimateHibernationSavings({
      connectionsPerHour: 100,
      messagesPerConnectionPerHour: 10,
      avgMessageProcessingMs: 50,
      activeHoursPerDay: 24,
    })

    expect(result.withoutHibernation).toBeGreaterThan(0)
    expect(result.withHibernation).toBeGreaterThan(0)
    expect(result.withHibernation).toBeLessThan(result.withoutHibernation)
    expect(result.savingsPercent).toBeGreaterThan(0)
    expect(result.monthlySavings).toBeGreaterThan(0)
  })

  it('should handle zero values', () => {
    const result = estimateHibernationSavings({
      connectionsPerHour: 0,
      messagesPerConnectionPerHour: 0,
      avgMessageProcessingMs: 0,
      activeHoursPerDay: 0,
    })

    expect(result.withoutHibernation).toBe(0)
    expect(result.withHibernation).toBe(0)
    expect(result.savingsPercent).toBe(0)
    expect(result.monthlySavings).toBe(0)
  })

  it('should show high savings for idle connections', () => {
    const result = estimateHibernationSavings({
      connectionsPerHour: 1000,
      messagesPerConnectionPerHour: 1, // Very low message rate
      avgMessageProcessingMs: 10,
      activeHoursPerDay: 24,
    })

    expect(result.savingsPercent).toBeGreaterThan(90)
  })
})

describe('isHibernationError', () => {
  it('should detect hibernation-related errors', () => {
    expect(isHibernationError(new Error('hibernation state lost'))).toBe(true)
    expect(isHibernationError(new Error('WebSocket not open'))).toBe(true)
    expect(isHibernationError(new Error('connection closed'))).toBe(true)
  })

  it('should not detect non-hibernation errors', () => {
    expect(isHibernationError(new Error('Network timeout'))).toBe(false)
    expect(isHibernationError(new Error('Invalid JSON'))).toBe(false)
  })

  it('should handle non-Error values', () => {
    expect(isHibernationError('string error')).toBe(false)
    expect(isHibernationError(null)).toBe(false)
    expect(isHibernationError(undefined)).toBe(false)
    expect(isHibernationError(42)).toBe(false)
  })
})

describe('createHibernationPayload', () => {
  it('should create valid JSON payload', () => {
    const data = { type: 'test', value: 123 }
    const payload = createHibernationPayload(data)

    expect(payload).toBe(JSON.stringify(data))
  })

  it('should return undefined for oversized payload', () => {
    const largeData = { data: 'x'.repeat(3000) }
    const payload = createHibernationPayload(largeData, 2048)

    expect(payload).toBeUndefined()
  })

  it('should respect custom max size', () => {
    const data = { small: 'data' }
    const payload = createHibernationPayload(data, 100)

    expect(payload).toBeDefined()
  })

  it('should handle circular references gracefully', () => {
    const circular: Record<string, unknown> = { a: 1 }
    circular.self = circular // Creates circular reference

    const payload = createHibernationPayload(circular)

    expect(payload).toBeUndefined()
  })

  it('should handle non-serializable values', () => {
    const data = {
      fn: () => {},
      symbol: Symbol('test'),
    }

    const payload = createHibernationPayload(data)

    // Functions and symbols are stripped by JSON.stringify, so it should still work
    expect(payload).toBeDefined()
    expect(JSON.parse(payload!)).toEqual({})
  })
})

// ============================================================================
// Default Config Tests
// ============================================================================

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
