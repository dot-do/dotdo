import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  SessionManager,
  calculateBackoffDelay,
  shouldRetry,
  createClientState,
  handleSessionInit,
  handleSessionResumed,
  handleSessionExpired,
  handleEvent,
  handleDisconnect,
  createResumeMessage,
  shouldAttemptResume,
  getNextRetryDelay,
  parseProtocolMessage,
  isProtocolMessage,
  RECONNECTION_PROTOCOL_VERSION,
  DEFAULT_BACKOFF_CONFIG,
  DEFAULT_RECONNECTION_CONFIG,
  type SessionState,
  type SessionInitMessage,
  type SessionResumedMessage,
  type SessionExpiredMessage,
  type EventMessage,
  type SessionResumeMessage,
  type ClientReconnectionState,
  type BackoffConfig,
} from '../websocket-reconnection'

/**
 * WebSocket Reconnection Protocol Tests
 *
 * Tests the reconnection protocol for WebSocket hibernation:
 * 1. Session management (create, resume, expire)
 * 2. Event buffering and replay
 * 3. Client-side state management
 * 4. Backoff calculations
 * 5. Protocol message parsing
 */

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock DurableObjectState for testing
 */
function createMockState(): DurableObjectState {
  const storage = new Map<string, unknown>()

  return {
    storage: {
      get: vi.fn(async (key: string) => storage.get(key)),
      put: vi.fn(async (key: string, value: unknown) => { storage.set(key, value) }),
      delete: vi.fn(async (key: string) => storage.delete(key)),
      list: vi.fn(async (options?: { prefix?: string }) => {
        const result = new Map<string, unknown>()
        for (const [key, value] of storage) {
          if (!options?.prefix || key.startsWith(options.prefix)) {
            result.set(key, value)
          }
        }
        return result
      }),
    },
    getWebSockets: vi.fn(() => []),
    acceptWebSocket: vi.fn(),
    id: { toString: () => 'test-do-id' },
  } as unknown as DurableObjectState
}

/**
 * Create a mock WebSocket for testing
 */
function createMockWebSocket(): WebSocket {
  const sentMessages: string[] = []
  let attachment: unknown = null

  return {
    readyState: 1,
    send: vi.fn((data: string) => sentMessages.push(data)),
    close: vi.fn(),
    serializeAttachment: vi.fn((data: unknown) => { attachment = data }),
    deserializeAttachment: vi.fn(() => attachment),
    _sentMessages: sentMessages,
    _attachment: attachment,
  } as unknown as WebSocket & { _sentMessages: string[]; _attachment: unknown }
}

// ============================================================================
// Backoff Calculation Tests
// ============================================================================

describe('Backoff Calculations', () => {
  describe('calculateBackoffDelay', () => {
    it('should return initial delay for first attempt', () => {
      const delay = calculateBackoffDelay(0)
      // Should be within jitter range of initialDelayMs (1000)
      expect(delay).toBeGreaterThanOrEqual(800)
      expect(delay).toBeLessThanOrEqual(1200)
    })

    it('should increase exponentially with attempts', () => {
      const delay0 = calculateBackoffDelay(0, { ...DEFAULT_BACKOFF_CONFIG, jitter: 0 })
      const delay1 = calculateBackoffDelay(1, { ...DEFAULT_BACKOFF_CONFIG, jitter: 0 })
      const delay2 = calculateBackoffDelay(2, { ...DEFAULT_BACKOFF_CONFIG, jitter: 0 })

      expect(delay1).toBe(delay0 * 2)
      expect(delay2).toBe(delay0 * 4)
    })

    it('should cap at maxDelayMs', () => {
      const config: BackoffConfig = {
        initialDelayMs: 1000,
        maxDelayMs: 5000,
        multiplier: 2,
        jitter: 0,
        maxAttempts: 10,
      }

      const delay10 = calculateBackoffDelay(10, config)
      expect(delay10).toBe(5000)
    })

    it('should add jitter to delays', () => {
      const config: BackoffConfig = {
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        multiplier: 2,
        jitter: 0.5,
        maxAttempts: 10,
      }

      // Run multiple times to ensure variation
      const delays = Array.from({ length: 10 }, () => calculateBackoffDelay(0, config))
      const uniqueDelays = new Set(delays)

      // With jitter, we should get some variation
      expect(uniqueDelays.size).toBeGreaterThan(1)
    })

    it('should never return negative delay', () => {
      for (let i = 0; i < 20; i++) {
        const delay = calculateBackoffDelay(i)
        expect(delay).toBeGreaterThanOrEqual(0)
      }
    })
  })

  describe('shouldRetry', () => {
    it('should return true when under maxAttempts', () => {
      expect(shouldRetry(0)).toBe(true)
      expect(shouldRetry(5)).toBe(true)
      expect(shouldRetry(9)).toBe(true)
    })

    it('should return false when at or over maxAttempts', () => {
      expect(shouldRetry(10)).toBe(false)
      expect(shouldRetry(11)).toBe(false)
    })

    it('should respect custom maxAttempts', () => {
      const config: BackoffConfig = {
        ...DEFAULT_BACKOFF_CONFIG,
        maxAttempts: 3,
      }

      expect(shouldRetry(2, config)).toBe(true)
      expect(shouldRetry(3, config)).toBe(false)
    })
  })
})

// ============================================================================
// Client State Management Tests
// ============================================================================

describe('Client State Management', () => {
  describe('createClientState', () => {
    it('should create initial state with defaults', () => {
      const state = createClientState()

      expect(state.sessionId).toBeNull()
      expect(state.lastSeq).toBe(0)
      expect(state.protocolVersion).toBe(RECONNECTION_PROTOCOL_VERSION)
      expect(state.attempt).toBe(0)
      expect(state.isConnected).toBe(false)
      expect(state.lastConnectedAt).toBeNull()
      expect(state.clientId).toBeUndefined()
    })

    it('should store clientId if provided', () => {
      const state = createClientState('my-client-id')
      expect(state.clientId).toBe('my-client-id')
    })
  })

  describe('handleSessionInit', () => {
    it('should update state from session.init message', () => {
      const state = createClientState()
      const message: SessionInitMessage = {
        type: 'session.init',
        sessionId: 'sess_123',
        protocolVersion: 1,
        seq: 5,
        timestamp: Date.now(),
        serverTime: Date.now(),
        heartbeatInterval: 30000,
        sessionTimeout: 1800000,
      }

      const newState = handleSessionInit(state, message)

      expect(newState.sessionId).toBe('sess_123')
      expect(newState.lastSeq).toBe(5)
      expect(newState.protocolVersion).toBe(1)
      expect(newState.attempt).toBe(0)
      expect(newState.isConnected).toBe(true)
      expect(newState.lastConnectedAt).not.toBeNull()
    })
  })

  describe('handleSessionResumed', () => {
    it('should update state from session.resumed message', () => {
      const state: ClientReconnectionState = {
        ...createClientState(),
        sessionId: 'sess_123',
        lastSeq: 5,
        attempt: 3,
        isConnected: false,
      }

      const message: SessionResumedMessage = {
        type: 'session.resumed',
        sessionId: 'sess_123',
        seq: 10,
        missedEventCount: 5,
        timestamp: Date.now(),
      }

      const newState = handleSessionResumed(state, message)

      expect(newState.sessionId).toBe('sess_123')
      expect(newState.lastSeq).toBe(10)
      expect(newState.attempt).toBe(0) // Reset on successful resume
      expect(newState.isConnected).toBe(true)
    })
  })

  describe('handleSessionExpired', () => {
    it('should update state from session.expired message', () => {
      const state: ClientReconnectionState = {
        ...createClientState(),
        sessionId: 'sess_old',
        lastSeq: 100,
        attempt: 2,
      }

      const message: SessionExpiredMessage = {
        type: 'session.expired',
        newSessionId: 'sess_new',
        reason: 'timeout',
        seq: 0,
        timestamp: Date.now(),
        protocolVersion: 1,
        heartbeatInterval: 30000,
        sessionTimeout: 1800000,
      }

      const newState = handleSessionExpired(state, message)

      expect(newState.sessionId).toBe('sess_new')
      expect(newState.lastSeq).toBe(0)
      expect(newState.attempt).toBe(0)
      expect(newState.isConnected).toBe(true)
    })
  })

  describe('handleEvent', () => {
    it('should update lastSeq from event message', () => {
      const state: ClientReconnectionState = {
        ...createClientState(),
        sessionId: 'sess_123',
        lastSeq: 5,
        isConnected: true,
      }

      const message: EventMessage = {
        type: 'event',
        seq: 6,
        eventType: 'user.updated',
        payload: { id: 'user-123' },
        timestamp: Date.now(),
      }

      const newState = handleEvent(state, message)

      expect(newState.lastSeq).toBe(6)
    })
  })

  describe('handleDisconnect', () => {
    it('should mark state as disconnected and increment attempt', () => {
      const state: ClientReconnectionState = {
        ...createClientState(),
        sessionId: 'sess_123',
        isConnected: true,
        attempt: 0,
      }

      const newState = handleDisconnect(state)

      expect(newState.isConnected).toBe(false)
      expect(newState.attempt).toBe(1)
    })
  })

  describe('createResumeMessage', () => {
    it('should create resume message from state', () => {
      const state: ClientReconnectionState = {
        ...createClientState('my-client'),
        sessionId: 'sess_123',
        lastSeq: 50,
      }

      const message = createResumeMessage(state)

      expect(message).toEqual({
        type: 'session.resume',
        sessionId: 'sess_123',
        lastSeq: 50,
        clientId: 'my-client',
      })
    })

    it('should return null if no sessionId', () => {
      const state = createClientState()
      const message = createResumeMessage(state)
      expect(message).toBeNull()
    })
  })

  describe('shouldAttemptResume', () => {
    it('should return true when sessionId exists', () => {
      const state: ClientReconnectionState = {
        ...createClientState(),
        sessionId: 'sess_123',
      }
      expect(shouldAttemptResume(state)).toBe(true)
    })

    it('should return false when no sessionId', () => {
      const state = createClientState()
      expect(shouldAttemptResume(state)).toBe(false)
    })
  })

  describe('getNextRetryDelay', () => {
    it('should return delay when under max attempts', () => {
      const state: ClientReconnectionState = {
        ...createClientState(),
        attempt: 2,
      }
      const delay = getNextRetryDelay(state)
      expect(delay).not.toBeNull()
      expect(delay).toBeGreaterThan(0)
    })

    it('should return null when max attempts exceeded', () => {
      const state: ClientReconnectionState = {
        ...createClientState(),
        attempt: 10,
      }
      const delay = getNextRetryDelay(state)
      expect(delay).toBeNull()
    })
  })
})

// ============================================================================
// Protocol Message Parsing Tests
// ============================================================================

describe('Protocol Message Parsing', () => {
  describe('parseProtocolMessage', () => {
    it('should parse valid JSON string', () => {
      const message = JSON.stringify({
        type: 'session.init',
        sessionId: 'sess_123',
      })

      const parsed = parseProtocolMessage(message)
      expect(parsed).not.toBeNull()
      expect(parsed?.type).toBe('session.init')
    })

    it('should parse ArrayBuffer', () => {
      const message = JSON.stringify({ type: 'event', seq: 1 })
      const buffer = new TextEncoder().encode(message)

      const parsed = parseProtocolMessage(buffer.buffer)
      expect(parsed).not.toBeNull()
      expect(parsed?.type).toBe('event')
    })

    it('should return null for invalid JSON', () => {
      const parsed = parseProtocolMessage('not valid json {')
      expect(parsed).toBeNull()
    })

    it('should return null for message without type', () => {
      const parsed = parseProtocolMessage(JSON.stringify({ data: 'test' }))
      expect(parsed).toBeNull()
    })
  })

  describe('isProtocolMessage', () => {
    it('should return true for valid protocol message types', () => {
      const validTypes = [
        'session.init',
        'session.resume',
        'session.resumed',
        'session.expired',
        'session.error',
        'event',
        'heartbeat.ping',
        'heartbeat.pong',
      ]

      for (const type of validTypes) {
        expect(isProtocolMessage({ type })).toBe(true)
      }
    })

    it('should return false for non-protocol message types', () => {
      expect(isProtocolMessage({ type: 'custom.message' })).toBe(false)
      expect(isProtocolMessage({ type: 'user.updated' })).toBe(false)
    })

    it('should return false for non-object values', () => {
      expect(isProtocolMessage(null)).toBe(false)
      expect(isProtocolMessage(undefined)).toBe(false)
      expect(isProtocolMessage('string')).toBe(false)
      expect(isProtocolMessage(123)).toBe(false)
    })

    it('should return false for object without type', () => {
      expect(isProtocolMessage({ data: 'test' })).toBe(false)
    })
  })
})

// ============================================================================
// SessionManager Tests
// ============================================================================

describe('SessionManager', () => {
  let mockState: DurableObjectState
  let manager: SessionManager

  beforeEach(() => {
    mockState = createMockState()
    manager = new SessionManager(mockState)
  })

  describe('createSession', () => {
    it('should create a new session with unique ID', () => {
      const ws = createMockWebSocket()
      const session = manager.createSession(ws)

      expect(session.sessionId).toMatch(/^sess_/)
      expect(session.currentSeq).toBe(0)
      expect(session.protocolVersion).toBe(RECONNECTION_PROTOCOL_VERSION)
      expect(session.eventBuffer).toEqual([])
    })

    it('should store clientId if provided', () => {
      const ws = createMockWebSocket()
      const session = manager.createSession(ws, 'my-client')

      expect(session.clientId).toBe('my-client')
    })

    it('should store metadata if provided', () => {
      const ws = createMockWebSocket()
      const session = manager.createSession(ws, undefined, { role: 'admin' })

      expect(session.metadata).toEqual({ role: 'admin' })
    })

    it('should create unique session IDs', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()

      const session1 = manager.createSession(ws1)
      const session2 = manager.createSession(ws2)

      expect(session1.sessionId).not.toBe(session2.sessionId)
    })
  })

  describe('getSession', () => {
    it('should return session for connected WebSocket', () => {
      const ws = createMockWebSocket()
      const created = manager.createSession(ws)

      const found = manager.getSession(ws)
      expect(found).toBe(created)
    })

    it('should return undefined for unknown WebSocket', () => {
      const ws = createMockWebSocket()
      const found = manager.getSession(ws)
      expect(found).toBeUndefined()
    })
  })

  describe('getSessionById', () => {
    it('should return session by ID', () => {
      const ws = createMockWebSocket()
      const created = manager.createSession(ws)

      const found = manager.getSessionById(created.sessionId)
      expect(found).toBe(created)
    })

    it('should return undefined for unknown ID', () => {
      const found = manager.getSessionById('nonexistent')
      expect(found).toBeUndefined()
    })
  })

  describe('touchSession', () => {
    it('should update lastActivityAt', () => {
      const ws = createMockWebSocket()
      const session = manager.createSession(ws)

      // Manually set an older timestamp to ensure a difference
      const oldTime = Date.now() - 1000
      session.lastActivityAt = oldTime

      manager.touchSession(ws)

      const after = manager.getSession(ws)?.lastActivityAt ?? 0
      expect(after).toBeGreaterThan(oldTime)
    })
  })

  describe('isSessionExpired', () => {
    it('should return false for fresh session', () => {
      const ws = createMockWebSocket()
      const session = manager.createSession(ws)

      expect(manager.isSessionExpired(session)).toBe(false)
    })

    it('should return true for old session', () => {
      const ws = createMockWebSocket()
      const session = manager.createSession(ws)

      // Set lastActivityAt to old timestamp
      session.lastActivityAt = Date.now() - (session.sessionTimeout + 1000)

      expect(manager.isSessionExpired(session)).toBe(true)
    })
  })

  describe('bufferEvent', () => {
    it('should buffer events with incrementing sequence', () => {
      const ws = createMockWebSocket()
      const session = manager.createSession(ws)

      const seq1 = manager.bufferEvent(session, 'user.created', { id: 1 })
      const seq2 = manager.bufferEvent(session, 'user.updated', { id: 1 })
      const seq3 = manager.bufferEvent(session, 'user.deleted', { id: 1 })

      expect(seq1).toBe(1)
      expect(seq2).toBe(2)
      expect(seq3).toBe(3)
      expect(session.eventBuffer.length).toBe(3)
    })

    it('should trim buffer when exceeding max size', () => {
      const customManager = new SessionManager(mockState, { maxEventBuffer: 3 })
      const ws = createMockWebSocket()
      const session = customManager.createSession(ws)

      // Add 5 events to buffer with max size 3
      for (let i = 0; i < 5; i++) {
        customManager.bufferEvent(session, `event.${i}`, { i })
      }

      expect(session.eventBuffer.length).toBe(3)
      // Should have kept the last 3 events (seq 3, 4, 5)
      expect(session.eventBuffer[0].seq).toBe(3)
      expect(session.eventBuffer[2].seq).toBe(5)
    })
  })

  describe('getEventsSince', () => {
    it('should return events after lastSeq', () => {
      const ws = createMockWebSocket()
      const session = manager.createSession(ws)

      manager.bufferEvent(session, 'event.1', {})
      manager.bufferEvent(session, 'event.2', {})
      manager.bufferEvent(session, 'event.3', {})

      const events = manager.getEventsSince(session, 1)

      expect(events).not.toBeNull()
      expect(events?.length).toBe(2)
      expect(events?.[0].seq).toBe(2)
      expect(events?.[1].seq).toBe(3)
    })

    it('should return empty array if lastSeq is current', () => {
      const ws = createMockWebSocket()
      const session = manager.createSession(ws)

      manager.bufferEvent(session, 'event.1', {})
      manager.bufferEvent(session, 'event.2', {})

      const events = manager.getEventsSince(session, 2)

      expect(events).not.toBeNull()
      expect(events?.length).toBe(0)
    })

    it('should return null if lastSeq is too old', () => {
      const customManager = new SessionManager(mockState, { maxEventBuffer: 3 })
      const ws = createMockWebSocket()
      const session = customManager.createSession(ws)

      // Add 5 events (buffer only holds 3)
      for (let i = 0; i < 5; i++) {
        customManager.bufferEvent(session, `event.${i}`, {})
      }

      // Client is asking for events from seq 0, but oldest is seq 3
      const events = customManager.getEventsSince(session, 0)
      expect(events).toBeNull()
    })
  })

  describe('createInitMessage', () => {
    it('should create valid session.init message', () => {
      const ws = createMockWebSocket()
      const session = manager.createSession(ws)

      const message = manager.createInitMessage(session)

      expect(message.type).toBe('session.init')
      expect(message.sessionId).toBe(session.sessionId)
      expect(message.protocolVersion).toBe(RECONNECTION_PROTOCOL_VERSION)
      expect(message.seq).toBe(session.currentSeq)
      expect(message.timestamp).toBeDefined()
      expect(message.serverTime).toBeDefined()
      expect(message.heartbeatInterval).toBeDefined()
      expect(message.sessionTimeout).toBeDefined()
    })
  })

  describe('createResumedMessage', () => {
    it('should create valid session.resumed message', () => {
      const ws = createMockWebSocket()
      const session = manager.createSession(ws)
      session.currentSeq = 10

      const message = manager.createResumedMessage(session, 5)

      expect(message.type).toBe('session.resumed')
      expect(message.sessionId).toBe(session.sessionId)
      expect(message.seq).toBe(10)
      expect(message.missedEventCount).toBe(5)
      expect(message.timestamp).toBeDefined()
    })
  })

  describe('createExpiredMessage', () => {
    it('should create valid session.expired message', () => {
      const ws = createMockWebSocket()
      const session = manager.createSession(ws)

      const message = manager.createExpiredMessage(session, 'timeout')

      expect(message.type).toBe('session.expired')
      expect(message.newSessionId).toBe(session.sessionId)
      expect(message.reason).toBe('timeout')
      expect(message.protocolVersion).toBe(RECONNECTION_PROTOCOL_VERSION)
    })
  })

  describe('createEventMessage', () => {
    it('should create event message and buffer it', () => {
      const ws = createMockWebSocket()
      const session = manager.createSession(ws)

      const message = manager.createEventMessage(session, 'user.created', { id: 123 })

      expect(message.type).toBe('event')
      expect(message.seq).toBe(1)
      expect(message.eventType).toBe('user.created')
      expect(message.payload).toEqual({ id: 123 })
      expect(session.eventBuffer.length).toBe(1)
    })
  })

  describe('resumeSession', () => {
    it('should successfully resume valid session', async () => {
      const ws1 = createMockWebSocket()
      const session = manager.createSession(ws1)

      // Add some events
      manager.bufferEvent(session, 'event.1', {})
      manager.bufferEvent(session, 'event.2', {})

      // New WebSocket for reconnection
      const ws2 = createMockWebSocket()
      const resumeMsg: SessionResumeMessage = {
        type: 'session.resume',
        sessionId: session.sessionId,
        lastSeq: 1,
      }

      const result = await manager.resumeSession(ws2, resumeMsg)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.session).toBe(session)
        expect(result.missedEvents.length).toBe(1)
        expect(result.missedEvents[0].seq).toBe(2)
      }
    })

    it('should fail for unknown session', async () => {
      const ws = createMockWebSocket()
      const resumeMsg: SessionResumeMessage = {
        type: 'session.resume',
        sessionId: 'nonexistent',
        lastSeq: 0,
      }

      const result = await manager.resumeSession(ws, resumeMsg)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('SESSION_NOT_FOUND')
        expect(result.reason).toBe('not_found')
        expect(result.newSession).toBeDefined()
      }
    })

    it('should fail for expired session', async () => {
      const ws1 = createMockWebSocket()
      const session = manager.createSession(ws1)

      // Force session expiry
      session.lastActivityAt = Date.now() - (session.sessionTimeout + 1000)

      const ws2 = createMockWebSocket()
      const resumeMsg: SessionResumeMessage = {
        type: 'session.resume',
        sessionId: session.sessionId,
        lastSeq: 0,
      }

      const result = await manager.resumeSession(ws2, resumeMsg)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('SESSION_EXPIRED')
        expect(result.reason).toBe('timeout')
      }
    })

    it('should fail when too many events missed', async () => {
      const customManager = new SessionManager(mockState, { maxEventBuffer: 3 })
      const ws1 = createMockWebSocket()
      const session = customManager.createSession(ws1)

      // Add 5 events (buffer only holds 3)
      for (let i = 0; i < 5; i++) {
        customManager.bufferEvent(session, `event.${i}`, {})
      }

      const ws2 = createMockWebSocket()
      const resumeMsg: SessionResumeMessage = {
        type: 'session.resume',
        sessionId: session.sessionId,
        lastSeq: 0, // Asking for events from the beginning
      }

      const result = await customManager.resumeSession(ws2, resumeMsg)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('REPLAY_BUFFER_OVERFLOW')
        expect(result.reason).toBe('evicted')
      }
    })
  })

  describe('handleDisconnect', () => {
    it('should preserve session for reconnection', () => {
      const ws = createMockWebSocket()
      const session = manager.createSession(ws)

      manager.handleDisconnect(ws)

      // Session should still exist by ID
      const found = manager.getSessionById(session.sessionId)
      expect(found).toBeDefined()

      // But not associated with WebSocket
      const fromWs = manager.getSession(ws)
      expect(fromWs).toBeUndefined()
    })
  })

  describe('cleanupExpiredSessions', () => {
    it('should remove expired sessions', async () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()

      const session1 = manager.createSession(ws1)
      const session2 = manager.createSession(ws2)

      // Expire session1
      session1.lastActivityAt = Date.now() - (session1.sessionTimeout + 1000)

      const cleaned = await manager.cleanupExpiredSessions()

      expect(cleaned).toBe(1)
      expect(manager.getSessionById(session1.sessionId)).toBeUndefined()
      expect(manager.getSessionById(session2.sessionId)).toBeDefined()
    })
  })

  describe('getStats', () => {
    it('should return correct statistics', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()

      const session1 = manager.createSession(ws1)
      manager.createSession(ws2)

      manager.bufferEvent(session1, 'event.1', {})
      manager.bufferEvent(session1, 'event.2', {})

      const stats = manager.getStats()

      expect(stats.activeSessions).toBe(2)
      expect(stats.totalBufferedEvents).toBe(2)
      expect(stats.oldestSessionAge).toBeGreaterThanOrEqual(0)
    })
  })
})
