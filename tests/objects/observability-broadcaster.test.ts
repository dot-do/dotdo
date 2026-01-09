/**
 * RED Phase Tests for ObservabilityBroadcaster Durable Object
 *
 * Tests for a WebSocket-based Durable Object that handles real-time
 * observability event streaming with hibernation support.
 *
 * The ObservabilityBroadcaster DO provides:
 * - WebSocket upgrade endpoint for clients to connect
 * - Hibernation API (ctx.acceptWebSocket) for efficient connection management
 * - POST /broadcast endpoint for receiving events to broadcast
 * - Per-connection filter support (level, script, etc.)
 * - Filter-based routing to only send relevant events to each client
 *
 * These tests will FAIL until the implementation is created.
 *
 * @see Issue: dotdo-4xsa - RED: ObservabilityBroadcaster DO WebSocket tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// These imports will FAIL until the implementation exists
import { ObservabilityBroadcaster } from '../../objects/ObservabilityBroadcaster'
import type {
  ObservabilityEvent,
  ObsFilter,
} from '../../types/observability'
import { matchesFilter } from '../../types/observability'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock WebSocket for testing
 */
class MockWebSocket {
  readyState: number = 1 // OPEN
  sentMessages: string[] = []
  closeCode?: number
  closeReason?: string

  send(message: string): void {
    this.sentMessages.push(message)
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3 // CLOSED
    this.closeCode = code
    this.closeReason = reason
  }
}

/**
 * Mock WebSocket pair for testing
 */
function createMockWebSocketPair(): [MockWebSocket, MockWebSocket] {
  const client = new MockWebSocket()
  const server = new MockWebSocket()
  return [client, server]
}

/**
 * Mock DurableObjectState with hibernation API
 */
interface MockDOState {
  id: { toString: () => string; name?: string }
  storage: {
    get: ReturnType<typeof vi.fn>
    put: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
  }
  waitUntil: ReturnType<typeof vi.fn>
  blockConcurrencyWhile: ReturnType<typeof vi.fn>
  // Hibernation API
  acceptWebSocket: ReturnType<typeof vi.fn>
  getWebSockets: ReturnType<typeof vi.fn>
  setWebSocketAutoResponse: ReturnType<typeof vi.fn>
}

function createMockDOState(): MockDOState {
  const connectedWebSockets: Array<{
    ws: MockWebSocket
    tags: string[]
    attachment?: unknown
  }> = []

  return {
    id: {
      toString: () => 'mock-do-id',
      name: 'observability-broadcaster',
    },
    storage: {
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
      delete: vi.fn(async () => true),
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async <T>(fn: () => Promise<T>) => fn()),
    // Hibernation API - stores connected WebSockets with their tags
    acceptWebSocket: vi.fn((ws: MockWebSocket, tags?: string[]) => {
      connectedWebSockets.push({ ws, tags: tags || [] })
    }),
    getWebSockets: vi.fn((tag?: string) => {
      if (tag) {
        return connectedWebSockets
          .filter((conn) => conn.tags.includes(tag))
          .map((conn) => conn.ws)
      }
      return connectedWebSockets.map((conn) => conn.ws)
    }),
    setWebSocketAutoResponse: vi.fn(),
  }
}

/**
 * Mock environment bindings
 */
interface MockEnv {
  // No bindings required for basic broadcaster
}

function createMockEnv(): MockEnv {
  return {}
}

/**
 * Create a test ObservabilityEvent
 */
function createTestEvent(overrides: Partial<ObservabilityEvent> = {}): ObservabilityEvent {
  return {
    id: crypto.randomUUID(),
    type: 'log',
    level: 'info',
    script: 'api-worker',
    timestamp: Date.now(),
    message: ['Test log message'],
    ...overrides,
  }
}

/**
 * Create a WebSocket upgrade request
 */
function createWebSocketRequest(
  url: string = 'http://localhost/ws',
  filters?: Partial<ObsFilter>
): Request {
  const urlObj = new URL(url)
  if (filters) {
    if (filters.level) urlObj.searchParams.set('level', filters.level)
    if (filters.script) urlObj.searchParams.set('script', filters.script)
    if (filters.type) urlObj.searchParams.set('type', filters.type)
    if (filters.requestId) urlObj.searchParams.set('requestId', filters.requestId)
    if (filters.doName) urlObj.searchParams.set('doName', filters.doName)
  }

  return new Request(urlObj.toString(), {
    headers: {
      Upgrade: 'websocket',
      Connection: 'Upgrade',
      'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version': '13',
    },
  })
}

/**
 * Create a broadcast request with events
 */
function createBroadcastRequest(events: ObservabilityEvent[]): Request {
  return new Request('http://localhost/broadcast', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(events),
  })
}

// ============================================================================
// TESTS: WebSocket Upgrade (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('ObservabilityBroadcaster WebSocket Upgrade', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv
  let broadcaster: ObservabilityBroadcaster

  beforeEach(() => {
    mockState = createMockDOState()
    mockEnv = createMockEnv()
    // This will fail until ObservabilityBroadcaster is implemented
    broadcaster = new ObservabilityBroadcaster(mockState as unknown as DurableObjectState, mockEnv)
  })

  it('returns 101 status for WebSocket upgrade request', async () => {
    const request = createWebSocketRequest()

    const response = await broadcaster.fetch(request)

    // WebSocket upgrade should return 101 Switching Protocols
    expect(response.status).toBe(101)
  })

  it('includes webSocket in response for upgrade request', async () => {
    const request = createWebSocketRequest()

    const response = await broadcaster.fetch(request)

    // Response should include the client WebSocket
    expect(response.webSocket).toBeDefined()
  })

  it('accepts WebSocket with hibernation API (ctx.acceptWebSocket)', async () => {
    const request = createWebSocketRequest()

    await broadcaster.fetch(request)

    // Should use hibernation API
    expect(mockState.acceptWebSocket).toHaveBeenCalled()
  })

  it('stores filter in WebSocket tags when provided', async () => {
    const request = createWebSocketRequest('http://localhost/ws', {
      level: 'error',
      script: 'api-worker',
    })

    await broadcaster.fetch(request)

    // acceptWebSocket should be called with tags including filter info
    expect(mockState.acceptWebSocket).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(['obs']) // Should have 'obs' tag at minimum
    )
  })
})

// ============================================================================
// TESTS: Filter Parsing (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('ObservabilityBroadcaster Filter Parsing', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv
  let broadcaster: ObservabilityBroadcaster

  beforeEach(() => {
    mockState = createMockDOState()
    mockEnv = createMockEnv()
    broadcaster = new ObservabilityBroadcaster(mockState as unknown as DurableObjectState, mockEnv)
  })

  it('parses level filter from query params', async () => {
    const request = createWebSocketRequest('http://localhost/ws?level=error')

    await broadcaster.fetch(request)

    // Filter should be parsed and stored with connection
    const callArgs = mockState.acceptWebSocket.mock.calls[0]
    const tags = callArgs?.[1] as string[] | undefined

    // Tags should include serialized filter with level=error
    expect(tags).toBeDefined()
    expect(tags?.some((t) => t.includes('error'))).toBe(true)
  })

  it('parses script filter from query params', async () => {
    const request = createWebSocketRequest('http://localhost/ws?script=api-worker')

    await broadcaster.fetch(request)

    const callArgs = mockState.acceptWebSocket.mock.calls[0]
    const tags = callArgs?.[1] as string[] | undefined

    expect(tags).toBeDefined()
    expect(tags?.some((t) => t.includes('api-worker'))).toBe(true)
  })

  it('parses multiple filter fields from query params', async () => {
    const request = createWebSocketRequest('http://localhost/ws', {
      level: 'error',
      script: 'api-worker',
      type: 'exception',
    })

    await broadcaster.fetch(request)

    const callArgs = mockState.acceptWebSocket.mock.calls[0]
    const tags = callArgs?.[1] as string[] | undefined

    expect(tags).toBeDefined()
    // Should contain all filter info
    expect(tags?.length).toBeGreaterThan(1)
  })

  it('handles empty filter (no query params)', async () => {
    const request = createWebSocketRequest('http://localhost/ws')

    await broadcaster.fetch(request)

    // Should still accept WebSocket with empty filter (matches all)
    expect(mockState.acceptWebSocket).toHaveBeenCalled()
  })
})

// ============================================================================
// TESTS: Broadcast Endpoint (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('ObservabilityBroadcaster POST /broadcast', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv
  let broadcaster: ObservabilityBroadcaster

  beforeEach(() => {
    mockState = createMockDOState()
    mockEnv = createMockEnv()
    broadcaster = new ObservabilityBroadcaster(mockState as unknown as DurableObjectState, mockEnv)
  })

  it('accepts POST /broadcast with events array', async () => {
    const events = [createTestEvent(), createTestEvent()]
    const request = createBroadcastRequest(events)

    const response = await broadcaster.fetch(request)

    expect(response.ok).toBe(true)
  })

  it('calls getWebSockets to get all connected clients', async () => {
    // First connect a WebSocket
    const wsRequest = createWebSocketRequest()
    await broadcaster.fetch(wsRequest)

    // Then broadcast
    const events = [createTestEvent()]
    const broadcastRequest = createBroadcastRequest(events)
    await broadcaster.fetch(broadcastRequest)

    // Should query connected WebSockets
    expect(mockState.getWebSockets).toHaveBeenCalled()
  })

  it('sends events to connected WebSocket clients', async () => {
    // Set up a mock connected WebSocket
    const mockWs = new MockWebSocket()
    mockState.getWebSockets = vi.fn(() => [mockWs])

    const events = [createTestEvent()]
    const request = createBroadcastRequest(events)
    await broadcaster.fetch(request)

    // WebSocket should have received the events
    expect(mockWs.sentMessages.length).toBeGreaterThan(0)
  })

  it('wraps events in proper message format', async () => {
    const mockWs = new MockWebSocket()
    mockState.getWebSockets = vi.fn(() => [mockWs])

    const events = [createTestEvent({ message: ['Test message'] })]
    const request = createBroadcastRequest(events)
    await broadcaster.fetch(request)

    // Should send JSON with type: 'events' and data array
    const sentMessage = JSON.parse(mockWs.sentMessages[0])
    expect(sentMessage).toHaveProperty('type', 'events')
    expect(sentMessage).toHaveProperty('data')
    expect(Array.isArray(sentMessage.data)).toBe(true)
  })

  it('returns 404 for unknown endpoints', async () => {
    const request = new Request('http://localhost/unknown')

    const response = await broadcaster.fetch(request)

    expect(response.status).toBe(404)
  })
})

// ============================================================================
// TESTS: Event Filtering (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('ObservabilityBroadcaster Event Filtering', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv
  let broadcaster: ObservabilityBroadcaster

  beforeEach(() => {
    mockState = createMockDOState()
    mockEnv = createMockEnv()
    broadcaster = new ObservabilityBroadcaster(mockState as unknown as DurableObjectState, mockEnv)
  })

  it('empty filter matches all events', async () => {
    // Connect with no filter
    const mockWs = new MockWebSocket()
    // Simulate attached filter as empty object
    ;(mockWs as unknown as { attachment?: { filter: ObsFilter } }).attachment = { filter: {} }
    mockState.getWebSockets = vi.fn(() => [mockWs])

    const events = [
      createTestEvent({ level: 'error' }),
      createTestEvent({ level: 'info' }),
      createTestEvent({ level: 'debug' }),
    ]
    const request = createBroadcastRequest(events)
    await broadcaster.fetch(request)

    // All events should be sent (empty filter matches all)
    const sentMessage = JSON.parse(mockWs.sentMessages[0])
    expect(sentMessage.data.length).toBe(3)
  })

  it('level filter only sends matching events', async () => {
    const mockWs = new MockWebSocket()
    ;(mockWs as unknown as { attachment?: { filter: ObsFilter } }).attachment = { filter: { level: 'error' } }
    mockState.getWebSockets = vi.fn(() => [mockWs])

    const events = [
      createTestEvent({ level: 'error' }),
      createTestEvent({ level: 'info' }),
      createTestEvent({ level: 'error' }),
    ]
    const request = createBroadcastRequest(events)
    await broadcaster.fetch(request)

    // Only error events should be sent
    const sentMessage = JSON.parse(mockWs.sentMessages[0])
    expect(sentMessage.data.length).toBe(2)
    expect(sentMessage.data.every((e: ObservabilityEvent) => e.level === 'error')).toBe(true)
  })

  it('script filter only sends matching events', async () => {
    const mockWs = new MockWebSocket()
    ;(mockWs as unknown as { attachment?: { filter: ObsFilter } }).attachment = { filter: { script: 'api-worker' } }
    mockState.getWebSockets = vi.fn(() => [mockWs])

    const events = [
      createTestEvent({ script: 'api-worker' }),
      createTestEvent({ script: 'background-worker' }),
      createTestEvent({ script: 'api-worker' }),
    ]
    const request = createBroadcastRequest(events)
    await broadcaster.fetch(request)

    const sentMessage = JSON.parse(mockWs.sentMessages[0])
    expect(sentMessage.data.length).toBe(2)
    expect(sentMessage.data.every((e: ObservabilityEvent) => e.script === 'api-worker')).toBe(true)
  })

  it('connection with filter only receives matching events', async () => {
    const errorOnlyWs = new MockWebSocket()
    ;(errorOnlyWs as unknown as { attachment?: { filter: ObsFilter } }).attachment = { filter: { level: 'error' } }

    const allEventsWs = new MockWebSocket()
    ;(allEventsWs as unknown as { attachment?: { filter: ObsFilter } }).attachment = { filter: {} }

    mockState.getWebSockets = vi.fn(() => [errorOnlyWs, allEventsWs])

    const events = [
      createTestEvent({ level: 'error' }),
      createTestEvent({ level: 'info' }),
    ]
    const request = createBroadcastRequest(events)
    await broadcaster.fetch(request)

    // Error-only client gets 1 event
    const errorMsg = JSON.parse(errorOnlyWs.sentMessages[0])
    expect(errorMsg.data.length).toBe(1)

    // All-events client gets 2 events
    const allMsg = JSON.parse(allEventsWs.sentMessages[0])
    expect(allMsg.data.length).toBe(2)
  })

  it('does not send message when no events match filter', async () => {
    const mockWs = new MockWebSocket()
    ;(mockWs as unknown as { attachment?: { filter: ObsFilter } }).attachment = { filter: { level: 'error' } }
    mockState.getWebSockets = vi.fn(() => [mockWs])

    // Only info events - none match error filter
    const events = [
      createTestEvent({ level: 'info' }),
      createTestEvent({ level: 'debug' }),
    ]
    const request = createBroadcastRequest(events)
    await broadcaster.fetch(request)

    // No messages should be sent
    expect(mockWs.sentMessages.length).toBe(0)
  })
})

// ============================================================================
// TESTS: Multiple Connections (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('ObservabilityBroadcaster Multiple Connections', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv
  let broadcaster: ObservabilityBroadcaster

  beforeEach(() => {
    mockState = createMockDOState()
    mockEnv = createMockEnv()
    broadcaster = new ObservabilityBroadcaster(mockState as unknown as DurableObjectState, mockEnv)
  })

  it('broadcasts to all connected clients', async () => {
    const ws1 = new MockWebSocket()
    const ws2 = new MockWebSocket()
    const ws3 = new MockWebSocket()

    // All have empty filter
    ;(ws1 as unknown as { attachment?: { filter: ObsFilter } }).attachment = { filter: {} }
    ;(ws2 as unknown as { attachment?: { filter: ObsFilter } }).attachment = { filter: {} }
    ;(ws3 as unknown as { attachment?: { filter: ObsFilter } }).attachment = { filter: {} }

    mockState.getWebSockets = vi.fn(() => [ws1, ws2, ws3])

    const events = [createTestEvent()]
    const request = createBroadcastRequest(events)
    await broadcaster.fetch(request)

    // All clients should receive the same message
    expect(ws1.sentMessages.length).toBe(1)
    expect(ws2.sentMessages.length).toBe(1)
    expect(ws3.sentMessages.length).toBe(1)
  })

  it('each connection can have different filters', async () => {
    const errorWs = new MockWebSocket()
    const infoWs = new MockWebSocket()

    ;(errorWs as unknown as { attachment?: { filter: ObsFilter } }).attachment = { filter: { level: 'error' } }
    ;(infoWs as unknown as { attachment?: { filter: ObsFilter } }).attachment = { filter: { level: 'info' } }

    mockState.getWebSockets = vi.fn(() => [errorWs, infoWs])

    const events = [
      createTestEvent({ level: 'error', message: ['Error event'] }),
      createTestEvent({ level: 'info', message: ['Info event'] }),
    ]
    const request = createBroadcastRequest(events)
    await broadcaster.fetch(request)

    // Each client receives only their filtered events
    const errorMsg = JSON.parse(errorWs.sentMessages[0])
    const infoMsg = JSON.parse(infoWs.sentMessages[0])

    expect(errorMsg.data.length).toBe(1)
    expect(errorMsg.data[0].level).toBe('error')

    expect(infoMsg.data.length).toBe(1)
    expect(infoMsg.data[0].level).toBe('info')
  })
})

// ============================================================================
// TESTS: WebSocket Hibernation Handlers (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('ObservabilityBroadcaster Hibernation Handlers', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv
  let broadcaster: ObservabilityBroadcaster

  beforeEach(() => {
    mockState = createMockDOState()
    mockEnv = createMockEnv()
    broadcaster = new ObservabilityBroadcaster(mockState as unknown as DurableObjectState, mockEnv)
  })

  describe('webSocketMessage handler', () => {
    it('handles filter update messages', async () => {
      const mockWs = new MockWebSocket()
      ;(mockWs as unknown as { attachment?: { filter: ObsFilter } }).attachment = { filter: {} }

      // Send a filter update message
      const filterUpdate = JSON.stringify({
        type: 'filter',
        filter: { level: 'error' },
      })

      await broadcaster.webSocketMessage(mockWs as unknown as WebSocket, filterUpdate)

      // Filter should be updated
      const attachment = (mockWs as unknown as { attachment?: { filter: ObsFilter } }).attachment
      expect(attachment?.filter.level).toBe('error')
    })

    it('ignores invalid JSON messages', async () => {
      const mockWs = new MockWebSocket()
      ;(mockWs as unknown as { attachment?: { filter: ObsFilter } }).attachment = { filter: {} }

      // Should not throw
      await expect(
        broadcaster.webSocketMessage(mockWs as unknown as WebSocket, 'invalid json')
      ).resolves.not.toThrow()
    })

    it('ignores messages with unknown type', async () => {
      const mockWs = new MockWebSocket()
      const originalFilter: ObsFilter = {}
      ;(mockWs as unknown as { attachment?: { filter: ObsFilter } }).attachment = { filter: originalFilter }

      const unknownMessage = JSON.stringify({
        type: 'unknown',
        data: 'something',
      })

      await broadcaster.webSocketMessage(mockWs as unknown as WebSocket, unknownMessage)

      // Filter should remain unchanged
      const attachment = (mockWs as unknown as { attachment?: { filter: ObsFilter } }).attachment
      expect(attachment?.filter).toEqual(originalFilter)
    })
  })

  describe('webSocketClose handler', () => {
    it('cleans up on connection close', async () => {
      const mockWs = new MockWebSocket()

      // Should not throw
      await expect(
        broadcaster.webSocketClose(mockWs as unknown as WebSocket, 1000, 'Normal closure', true)
      ).resolves.not.toThrow()
    })

    it('handles abnormal closure gracefully', async () => {
      const mockWs = new MockWebSocket()

      // Abnormal closure (not wasClean)
      await expect(
        broadcaster.webSocketClose(mockWs as unknown as WebSocket, 1006, 'Abnormal closure', false)
      ).resolves.not.toThrow()
    })
  })
})

// ============================================================================
// TESTS: Integration matchesFilter (verify types work together)
// ============================================================================

describe('ObservabilityBroadcaster uses matchesFilter', () => {
  it('matchesFilter correctly filters events', () => {
    const event: ObservabilityEvent = {
      id: crypto.randomUUID(),
      type: 'log',
      level: 'error',
      script: 'api-worker',
      timestamp: Date.now(),
    }

    // Empty filter matches all
    expect(matchesFilter(event, {})).toBe(true)

    // Level filter
    expect(matchesFilter(event, { level: 'error' })).toBe(true)
    expect(matchesFilter(event, { level: 'info' })).toBe(false)

    // Script filter
    expect(matchesFilter(event, { script: 'api-worker' })).toBe(true)
    expect(matchesFilter(event, { script: 'other-worker' })).toBe(false)

    // Multiple filters (AND logic)
    expect(matchesFilter(event, { level: 'error', script: 'api-worker' })).toBe(true)
    expect(matchesFilter(event, { level: 'error', script: 'other-worker' })).toBe(false)
  })
})
