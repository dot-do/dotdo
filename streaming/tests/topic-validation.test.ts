/**
 * Topic Input Validation Tests
 *
 * Tests for validateTopic function that protects against:
 * - Excessively long topic names (DoS)
 * - Invalid characters that could cause issues
 * - Path traversal attempts
 * - Empty/whitespace-only topics
 * - Control characters and special injection characters
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Install WebSocket mock for test environment
import { installWebSocketMock } from './utils/websocket-mock'
installWebSocketMock()

import { EventStreamDO, validateTopic } from '../event-stream-do'

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
// validateTopic UNIT TESTS
// ============================================================================

describe('validateTopic', () => {
  describe('valid topics', () => {
    it('accepts simple alphanumeric topic', () => {
      const result = validateTopic('orders')
      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('accepts topic with dots', () => {
      const result = validateTopic('orders.created')
      expect(result.valid).toBe(true)
    })

    it('accepts topic with dashes', () => {
      const result = validateTopic('user-events')
      expect(result.valid).toBe(true)
    })

    it('accepts topic with underscores and numbers', () => {
      const result = validateTopic('topic_123')
      expect(result.valid).toBe(true)
    })

    it('accepts topic with wildcard asterisk', () => {
      const result = validateTopic('orders.*')
      expect(result.valid).toBe(true)
    })

    it('accepts complex valid topic', () => {
      const result = validateTopic('tenant-123.orders.created_v2')
      expect(result.valid).toBe(true)
    })

    it('accepts single character topic', () => {
      const result = validateTopic('a')
      expect(result.valid).toBe(true)
    })

    it('accepts wildcard-only topic', () => {
      const result = validateTopic('*')
      expect(result.valid).toBe(true)
    })
  })

  describe('rejects too long topics', () => {
    it('rejects topic exceeding 256 characters', () => {
      const longTopic = 'a'.repeat(257)
      const result = validateTopic(longTopic)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('256')
    })

    it('accepts topic exactly at 256 characters', () => {
      const maxTopic = 'a'.repeat(256)
      const result = validateTopic(maxTopic)
      expect(result.valid).toBe(true)
    })
  })

  describe('rejects empty topics', () => {
    it('rejects empty string', () => {
      const result = validateTopic('')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('empty')
    })

    it('rejects whitespace-only string', () => {
      const result = validateTopic('   ')
      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('rejects tabs-only string', () => {
      const result = validateTopic('\t\t')
      expect(result.valid).toBe(false)
    })
  })

  describe('rejects invalid characters', () => {
    it('rejects topic with spaces', () => {
      const result = validateTopic('orders created')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('character')
    })

    it('rejects topic with newlines', () => {
      const result = validateTopic('orders\ncreated')
      expect(result.valid).toBe(false)
    })

    it('rejects topic with carriage returns', () => {
      const result = validateTopic('orders\rcreated')
      expect(result.valid).toBe(false)
    })

    it('rejects topic with control characters', () => {
      const result = validateTopic('orders\x00created') // null byte
      expect(result.valid).toBe(false)
    })

    it('rejects topic with bell character', () => {
      const result = validateTopic('orders\x07created')
      expect(result.valid).toBe(false)
    })
  })

  describe('rejects path traversal attempts', () => {
    it('rejects parent directory traversal', () => {
      const result = validateTopic('../secret')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('path traversal')
    })

    it('rejects double-dot only', () => {
      const result = validateTopic('..')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('path traversal')
    })

    it('rejects nested path traversal', () => {
      const result = validateTopic('../../etc/passwd')
      expect(result.valid).toBe(false)
    })

    it('rejects path traversal in middle of topic', () => {
      const result = validateTopic('orders/../admin')
      expect(result.valid).toBe(false)
    })

    it('rejects Windows-style path traversal', () => {
      const result = validateTopic('..\\secret')
      expect(result.valid).toBe(false)
    })
  })

  describe('rejects special dangerous characters', () => {
    it('rejects null bytes', () => {
      const result = validateTopic('orders\x00')
      expect(result.valid).toBe(false)
    })

    it('rejects semicolons (command injection)', () => {
      const result = validateTopic('orders;rm -rf')
      expect(result.valid).toBe(false)
    })

    it('rejects backticks (command substitution)', () => {
      const result = validateTopic('orders`whoami`')
      expect(result.valid).toBe(false)
    })

    it('rejects dollar signs (variable expansion)', () => {
      const result = validateTopic('orders$PATH')
      expect(result.valid).toBe(false)
    })

    it('rejects pipe character', () => {
      const result = validateTopic('orders|cat')
      expect(result.valid).toBe(false)
    })

    it('rejects ampersand', () => {
      const result = validateTopic('orders&background')
      expect(result.valid).toBe(false)
    })

    it('rejects angle brackets', () => {
      expect(validateTopic('orders<script>').valid).toBe(false)
      expect(validateTopic('orders>file').valid).toBe(false)
    })

    it('rejects quotes', () => {
      expect(validateTopic("orders'quote").valid).toBe(false)
      expect(validateTopic('orders"quote').valid).toBe(false)
    })

    it('rejects slashes (path separators)', () => {
      expect(validateTopic('orders/subpath').valid).toBe(false)
      expect(validateTopic('orders\\subpath').valid).toBe(false)
    })
  })
})

// ============================================================================
// INTEGRATION TESTS - WebSocket Upgrade
// ============================================================================

describe('EventStreamDO topic validation integration', () => {
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

  describe('WebSocket upgrade endpoint', () => {
    it('accepts connection with valid topic', async () => {
      const request = new Request('https://test.api/events?topic=orders', {
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStreamDO.fetch(request)
      expect(response.status).toBe(101)
    })

    it('rejects connection with invalid topic - too long', async () => {
      const longTopic = 'a'.repeat(257)
      const request = new Request(`https://test.api/events?topic=${longTopic}`, {
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStreamDO.fetch(request)
      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toContain('topic')
    })

    it('rejects connection with path traversal in topic', async () => {
      const request = new Request('https://test.api/events?topic=../secret', {
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStreamDO.fetch(request)
      expect(response.status).toBe(400)
    })

    it('rejects connection with control characters in topic', async () => {
      const request = new Request('https://test.api/events?topic=orders%00admin', {
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStreamDO.fetch(request)
      expect(response.status).toBe(400)
    })

    it('validates all topics when multiple are provided', async () => {
      const request = new Request('https://test.api/events?topic=valid&topic=../invalid', {
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStreamDO.fetch(request)
      expect(response.status).toBe(400)
    })
  })

  describe('Broadcast endpoint', () => {
    it('accepts broadcast to valid topic', async () => {
      const request = new Request('https://test.api/broadcast', {
        method: 'POST',
        body: JSON.stringify({ topic: 'orders', event: { type: 'test' } }),
        headers: { 'Content-Type': 'application/json' },
      })

      const response = await eventStreamDO.fetch(request)
      expect(response.status).toBe(200)
    })

    it('rejects broadcast to invalid topic - too long', async () => {
      const longTopic = 'a'.repeat(257)
      const request = new Request('https://test.api/broadcast', {
        method: 'POST',
        body: JSON.stringify({ topic: longTopic, event: { type: 'test' } }),
        headers: { 'Content-Type': 'application/json' },
      })

      const response = await eventStreamDO.fetch(request)
      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toContain('topic')
    })

    it('rejects broadcast with path traversal in topic', async () => {
      const request = new Request('https://test.api/broadcast', {
        method: 'POST',
        body: JSON.stringify({ topic: '../admin', event: { type: 'test' } }),
        headers: { 'Content-Type': 'application/json' },
      })

      const response = await eventStreamDO.fetch(request)
      expect(response.status).toBe(400)
    })

    it('rejects broadcast with semicolon in topic', async () => {
      const request = new Request('https://test.api/broadcast', {
        method: 'POST',
        body: JSON.stringify({ topic: 'orders;DROP TABLE', event: { type: 'test' } }),
        headers: { 'Content-Type': 'application/json' },
      })

      const response = await eventStreamDO.fetch(request)
      expect(response.status).toBe(400)
    })

    it('validates topic in event.topic field', async () => {
      const request = new Request('https://test.api/broadcast', {
        method: 'POST',
        body: JSON.stringify({ event: { type: 'test', topic: '../escape' } }),
        headers: { 'Content-Type': 'application/json' },
      })

      const response = await eventStreamDO.fetch(request)
      expect(response.status).toBe(400)
    })

    it('validates ns field in UnifiedEvent broadcasts', async () => {
      const request = new Request('https://test.api/broadcast', {
        method: 'POST',
        body: JSON.stringify({
          event_type: 'trace',
          event_name: 'test',
          ns: '../admin',
        }),
        headers: { 'Content-Type': 'application/json' },
      })

      const response = await eventStreamDO.fetch(request)
      expect(response.status).toBe(400)
    })
  })
})
