/**
 * EventStreamDO Broadcast Endpoint Error Handling Tests
 *
 * Tests for handleBroadcastEndpoint JSON error handling.
 * Verifies:
 * - Invalid JSON returns 400 (not 500)
 * - Empty body returns 400
 * - Non-object JSON returns 400
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Install WebSocket mock for test environment
import { installWebSocketMock } from './utils/websocket-mock'
installWebSocketMock()

import { EventStreamDO } from '../event-stream-do'

// ============================================================================
// MOCK DURABLE OBJECT STATE
// ============================================================================

const createMockState = () => {
  const storage = new Map<string, unknown>()
  const alarms: number[] = []

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
    getWebSockets: vi.fn(() => []),
    acceptWebSocket: vi.fn(),
    _storage: storage,
    _alarms: alarms,
  }
}

type MockState = ReturnType<typeof createMockState>

// ============================================================================
// TEST SUITES
// ============================================================================

describe('EventStreamDO', () => {
  let mockState: MockState
  let eventStreamDO: EventStreamDO

  beforeEach(() => {
    vi.useFakeTimers()
    mockState = createMockState()
    eventStreamDO = new EventStreamDO(mockState)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('handleBroadcastEndpoint error handling', () => {
    it('returns 400 for invalid JSON body', async () => {
      // Create request with invalid JSON
      const request = new Request('https://test.api/broadcast', {
        method: 'POST',
        body: 'not valid json {{{',
        headers: { 'Content-Type': 'application/json' },
      })

      // This should return 400, not throw/500
      const response = await eventStreamDO.fetch(request)
      expect(response.status).toBe(400)

      const body = (await response.json()) as { error: string }
      expect(body.error).toBeDefined()
    })

    it('returns 400 for empty body', async () => {
      const request = new Request('https://test.api/broadcast', {
        method: 'POST',
        body: '',
        headers: { 'Content-Type': 'application/json' },
      })

      const response = await eventStreamDO.fetch(request)
      expect(response.status).toBe(400)
    })

    it('returns 400 for non-object JSON (array)', async () => {
      const request = new Request('https://test.api/broadcast', {
        method: 'POST',
        body: JSON.stringify([1, 2, 3]), // Array instead of object
        headers: { 'Content-Type': 'application/json' },
      })

      const response = await eventStreamDO.fetch(request)
      expect(response.status).toBe(400)

      const body = (await response.json()) as { error: string }
      expect(body.error).toBeDefined()
    })

    it('returns 400 for non-object JSON (string)', async () => {
      const request = new Request('https://test.api/broadcast', {
        method: 'POST',
        body: JSON.stringify('just a string'),
        headers: { 'Content-Type': 'application/json' },
      })

      const response = await eventStreamDO.fetch(request)
      expect(response.status).toBe(400)
    })

    it('returns 400 for non-object JSON (number)', async () => {
      const request = new Request('https://test.api/broadcast', {
        method: 'POST',
        body: JSON.stringify(42),
        headers: { 'Content-Type': 'application/json' },
      })

      const response = await eventStreamDO.fetch(request)
      expect(response.status).toBe(400)
    })

    it('returns 400 for null body', async () => {
      const request = new Request('https://test.api/broadcast', {
        method: 'POST',
        body: JSON.stringify(null),
        headers: { 'Content-Type': 'application/json' },
      })

      const response = await eventStreamDO.fetch(request)
      expect(response.status).toBe(400)
    })
  })
})
