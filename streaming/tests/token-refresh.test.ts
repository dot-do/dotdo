/**
 * Token Refresh Validation Tests
 *
 * Tests for token refresh validation in EventStreamDO.
 * These tests verify that token refresh actually validates tokens
 * rather than blindly accepting any token.
 *
 * Security tests for:
 * - Valid token format acceptance
 * - Expired token rejection
 * - Malformed token rejection
 * - Empty token rejection
 * - Custom token validator function
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Install WebSocket mock for test environment
import { installWebSocketMock, MockWebSocket } from './utils/websocket-mock'
installWebSocketMock()

import { EventStreamDO } from '../event-stream-do'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Creates a mock JWT token with the given payload and expiration
 */
function createMockJWT(payload: Record<string, unknown>, expiresIn?: number): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const fullPayload = {
    ...payload,
    iat: now,
    ...(expiresIn !== undefined ? { exp: now + expiresIn } : {}),
  }

  // Base64url encode (simplified for testing - not cryptographically valid)
  const base64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url')

  const headerB64 = base64url(header)
  const payloadB64 = base64url(fullPayload)
  // Fake signature for testing format validation
  const signatureB64 = Buffer.from('fake-signature-for-testing').toString('base64url')

  return `${headerB64}.${payloadB64}.${signatureB64}`
}

/**
 * Creates an expired JWT token
 */
function createExpiredJWT(payload: Record<string, unknown> = {}): string {
  return createMockJWT(payload, -3600) // Expired 1 hour ago
}

/**
 * Creates a valid JWT token (expires in 1 hour)
 */
function createValidJWT(payload: Record<string, unknown> = {}): string {
  return createMockJWT(payload, 3600) // Expires in 1 hour
}

// ============================================================================
// MOCK DURABLE OBJECT STATE
// ============================================================================

const createMockState = () => {
  const storage = new Map<string, unknown>()
  const alarms: number[] = []
  const webSockets: WebSocket[] = []

  return {
    storage: {
      get: vi.fn(async (key: string) => storage.get(key)),
      put: vi.fn(async (key: string, value: unknown) => {
        storage.set(key, value)
      }),
      delete: vi.fn(async (key: string) => storage.delete(key)),
      deleteAll: vi.fn(async () => storage.clear()),
      list: vi.fn(async () => storage),
    },
    waitUntil: vi.fn(),
    setAlarm: vi.fn((timestamp: number) => alarms.push(timestamp)),
    getAlarm: vi.fn(async () => alarms[0]),
    deleteAlarm: vi.fn(async () => {
      alarms.length = 0
    }),
    getWebSockets: vi.fn(() => webSockets),
    acceptWebSocket: vi.fn((ws: WebSocket) => {
      webSockets.push(ws)
    }),
    _storage: storage,
    _alarms: alarms,
    _webSockets: webSockets,
  }
}

type MockState = ReturnType<typeof createMockState>

/**
 * Helper to establish a WebSocket connection and set up message tracking
 */
async function setupWebSocket(eventStreamDO: EventStreamDO, mockState: MockState) {
  const request = new Request('https://test.api/events?topic=test', {
    headers: { Upgrade: 'websocket' },
  })
  const response = await eventStreamDO.fetch(request)

  // Get the server WebSocket
  const serverWs = mockState._webSockets[0] as unknown as MockWebSocket

  // Track messages sent back to client
  const messages: string[] = []
  serverWs.send.mockImplementation((data: string) => {
    messages.push(data)
  })

  return { response, serverWs, messages }
}

/**
 * Helper to send a token refresh message and get the response
 * Uses webSocketMessage directly to simulate the hibernation handler
 */
async function sendTokenRefresh(
  eventStreamDO: EventStreamDO,
  serverWs: MockWebSocket,
  messages: string[],
  token: unknown
) {
  // Call webSocketMessage directly (simulating hibernation handler)
  await eventStreamDO.webSocketMessage(
    serverWs as unknown as WebSocket,
    JSON.stringify({ type: 'refresh_token', token })
  )

  // Find relevant message
  const tokenRefreshedMsg = messages.find((m) => {
    try {
      const parsed = JSON.parse(m)
      return parsed.type === 'token_refreshed'
    } catch {
      return false
    }
  })

  const tokenErrorMsg = messages.find((m) => {
    try {
      const parsed = JSON.parse(m)
      return parsed.type === 'token_error'
    } catch {
      return false
    }
  })

  return { tokenRefreshedMsg, tokenErrorMsg }
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('EventStreamDO Token Refresh Validation', () => {
  let mockState: MockState
  let eventStreamDO: EventStreamDO

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
    mockState = createMockState()
    eventStreamDO = new EventStreamDO(mockState)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('valid token format acceptance', () => {
    it('should accept a valid JWT-formatted token', async () => {
      const { response, serverWs, messages } = await setupWebSocket(eventStreamDO, mockState)
      expect(response.status).toBe(101) // WebSocket upgrade

      const validToken = createValidJWT({ sub: 'user-123', topics: ['test'] })
      const { tokenRefreshedMsg } = await sendTokenRefresh(eventStreamDO, serverWs, messages, validToken)

      expect(tokenRefreshedMsg).toBeDefined()
      const parsed = JSON.parse(tokenRefreshedMsg!)
      expect(parsed.type).toBe('token_refreshed')
      expect(parsed.timestamp).toBeDefined()
    })
  })

  describe('expired token rejection', () => {
    it('should reject an expired JWT token', async () => {
      const { response, serverWs, messages } = await setupWebSocket(eventStreamDO, mockState)
      expect(response.status).toBe(101)

      const expiredToken = createExpiredJWT({ sub: 'user-123' })
      const { tokenErrorMsg } = await sendTokenRefresh(eventStreamDO, serverWs, messages, expiredToken)

      expect(tokenErrorMsg).toBeDefined()
      const parsed = JSON.parse(tokenErrorMsg!)
      expect(parsed.type).toBe('token_error')
      expect(parsed.error).toContain('expired')
    })
  })

  describe('malformed token rejection', () => {
    it('should reject a token without three segments', async () => {
      const { response, serverWs, messages } = await setupWebSocket(eventStreamDO, mockState)
      expect(response.status).toBe(101)

      const { tokenErrorMsg } = await sendTokenRefresh(eventStreamDO, serverWs, messages, 'invalid.token')

      expect(tokenErrorMsg).toBeDefined()
      const parsed = JSON.parse(tokenErrorMsg!)
      expect(parsed.type).toBe('token_error')
      expect(parsed.error).toContain('format')
    })

    it('should reject a token with invalid base64 encoding', async () => {
      const { response, serverWs, messages } = await setupWebSocket(eventStreamDO, mockState)
      expect(response.status).toBe(101)

      const { tokenErrorMsg } = await sendTokenRefresh(eventStreamDO, serverWs, messages, '!!!.@@@.###')

      expect(tokenErrorMsg).toBeDefined()
    })

    it('should reject a plain string as token', async () => {
      const { response, serverWs, messages } = await setupWebSocket(eventStreamDO, mockState)
      expect(response.status).toBe(101)

      const { tokenErrorMsg } = await sendTokenRefresh(eventStreamDO, serverWs, messages, 'just-a-random-string')

      expect(tokenErrorMsg).toBeDefined()
    })
  })

  describe('empty token rejection', () => {
    it('should reject an empty string token', async () => {
      const { response, serverWs, messages } = await setupWebSocket(eventStreamDO, mockState)
      expect(response.status).toBe(101)

      const { tokenErrorMsg } = await sendTokenRefresh(eventStreamDO, serverWs, messages, '')

      expect(tokenErrorMsg).toBeDefined()
      const parsed = JSON.parse(tokenErrorMsg!)
      expect(parsed.type).toBe('token_error')
      expect(parsed.error).toContain('empty')
    })

    it('should reject an undefined token', async () => {
      const { response, serverWs, messages } = await setupWebSocket(eventStreamDO, mockState)
      expect(response.status).toBe(101)

      const { tokenErrorMsg } = await sendTokenRefresh(eventStreamDO, serverWs, messages, undefined)

      expect(tokenErrorMsg).toBeDefined()
    })

    it('should reject a null token', async () => {
      const { response, serverWs, messages } = await setupWebSocket(eventStreamDO, mockState)
      expect(response.status).toBe(101)

      const { tokenErrorMsg } = await sendTokenRefresh(eventStreamDO, serverWs, messages, null)

      expect(tokenErrorMsg).toBeDefined()
    })
  })

  describe('custom token validator', () => {
    it('should use custom token validator when set', async () => {
      // Set a custom token validator that only accepts specific tokens
      const customValidator = vi.fn(async (token: string) => {
        return token === 'magic-token-123'
      })
      eventStreamDO.setTokenRefreshValidator(customValidator)

      const { response, serverWs, messages } = await setupWebSocket(eventStreamDO, mockState)
      expect(response.status).toBe(101)

      const { tokenRefreshedMsg } = await sendTokenRefresh(eventStreamDO, serverWs, messages, 'magic-token-123')

      // Custom validator should have been called
      expect(customValidator).toHaveBeenCalledWith('magic-token-123')

      // Should accept the token
      expect(tokenRefreshedMsg).toBeDefined()
    })

    it('should reject token when custom validator returns false', async () => {
      const customValidator = vi.fn(async () => false)
      eventStreamDO.setTokenRefreshValidator(customValidator)

      const { response, serverWs, messages } = await setupWebSocket(eventStreamDO, mockState)
      expect(response.status).toBe(101)

      const { tokenErrorMsg } = await sendTokenRefresh(eventStreamDO, serverWs, messages, createValidJWT({}))

      expect(tokenErrorMsg).toBeDefined()
    })

    it('should support custom validator returning validation result with allowed topics', async () => {
      const customValidator = vi.fn(async (token: string) => ({
        valid: true,
        allowedTopics: ['orders', 'payments'],
      }))
      eventStreamDO.setTokenRefreshValidator(customValidator)

      const { response, serverWs, messages } = await setupWebSocket(eventStreamDO, mockState)
      expect(response.status).toBe(101)

      const { tokenRefreshedMsg } = await sendTokenRefresh(eventStreamDO, serverWs, messages, 'custom-token')

      expect(tokenRefreshedMsg).toBeDefined()
      const parsed = JSON.parse(tokenRefreshedMsg!)
      expect(parsed.allowedTopics).toEqual(['orders', 'payments'])
    })
  })

  describe('token validation error responses', () => {
    it('should include descriptive error message for format errors', async () => {
      const { response, serverWs, messages } = await setupWebSocket(eventStreamDO, mockState)
      expect(response.status).toBe(101)

      const { tokenErrorMsg } = await sendTokenRefresh(eventStreamDO, serverWs, messages, 'bad')

      expect(tokenErrorMsg).toBeDefined()
      const parsed = JSON.parse(tokenErrorMsg!)
      expect(parsed.error).toBeDefined()
      expect(typeof parsed.error).toBe('string')
      expect(parsed.error.length).toBeGreaterThan(0)
    })

    it('should include timestamp in error response', async () => {
      const { response, serverWs, messages } = await setupWebSocket(eventStreamDO, mockState)
      expect(response.status).toBe(101)

      const { tokenErrorMsg } = await sendTokenRefresh(eventStreamDO, serverWs, messages, '')

      expect(tokenErrorMsg).toBeDefined()
      const parsed = JSON.parse(tokenErrorMsg!)
      expect(parsed.timestamp).toBeDefined()
      expect(typeof parsed.timestamp).toBe('number')
    })
  })
})
