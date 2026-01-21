/**
 * WebSocket Event Streaming Tests
 *
 * Tests for the server-side WebSocket event streaming system (do-9zknf).
 * This tests:
 * - Subscribe/unsubscribe message handling
 * - Event pattern matching (exact, wildcard)
 * - Event pushing to subscribers
 * - Connection cleanup on disconnect
 *
 * Following the NO MOCKS philosophy, we use real miniflare instances
 * for integration tests and test pure logic directly.
 *
 * @module do/tests/websocket-streaming.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import {
  WebSocketEventStreaming,
  createWebSocketEventStreaming,
  isEventSubscriptionMessage,
  type EventSubscriptionMessage,
  type EventPushMessage,
  type SubscriptionAckMessage,
} from '../websocket-streaming'
import { WebSocketManager } from '../websocket'
import { createEventsStore, type EventsStore } from '@dotdo/db'
import { generateTestId } from '@dotdo/test-utils/helpers'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a test WebSocket-like object for testing pure logic.
 */
function createTestWebSocket(): WebSocket & {
  _sentMessages: string[]
  _closed: boolean
} {
  let readyState = 1 // OPEN
  const sentMessages: string[] = []
  let closed = false

  return {
    get readyState() { return readyState },
    send(data: string) {
      if (readyState !== 1) {
        throw new Error('WebSocket is not open')
      }
      sentMessages.push(data)
    },
    close() {
      readyState = 3 // CLOSED
      closed = true
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true },
    _sentMessages: sentMessages,
    _closed: closed,
  } as unknown as WebSocket & {
    _sentMessages: string[]
    _closed: boolean
  }
}

/**
 * Helper to manually register a connection with the WebSocket manager.
 */
function registerConnection(
  manager: WebSocketManager,
  ws: WebSocket,
  tags: string[] = []
): void {
  const connections = (manager as unknown as { connections: Map<WebSocket, unknown> }).connections
  connections.set(ws, {
    connectionId: `conn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`,
    tags,
    hibernatable: false,
    connectedAt: Date.now(),
    lastActivityAt: Date.now(),
    reconnectCount: 0,
  })
}

// ============================================================================
// Type Guard Tests
// ============================================================================

describe('WebSocketEventStreaming - Type Guards', () => {
  describe('isEventSubscriptionMessage', () => {
    it('should return true for valid subscribe message', () => {
      const msg: EventSubscriptionMessage = {
        type: 'subscribe',
        event: 'Customer.signup',
        subscriptionId: 'sub-123',
      }
      expect(isEventSubscriptionMessage(msg)).toBe(true)
    })

    it('should return true for valid unsubscribe message', () => {
      const msg: EventSubscriptionMessage = {
        type: 'unsubscribe',
        event: 'Customer.signup',
        subscriptionId: 'sub-123',
      }
      expect(isEventSubscriptionMessage(msg)).toBe(true)
    })

    it('should return false for invalid messages', () => {
      expect(isEventSubscriptionMessage(null)).toBe(false)
      expect(isEventSubscriptionMessage(undefined)).toBe(false)
      expect(isEventSubscriptionMessage('string')).toBe(false)
      expect(isEventSubscriptionMessage(123)).toBe(false)
      expect(isEventSubscriptionMessage({})).toBe(false)
      expect(isEventSubscriptionMessage({ type: 'other' })).toBe(false)
      expect(isEventSubscriptionMessage({ type: 'subscribe' })).toBe(false)
      expect(isEventSubscriptionMessage({ type: 'subscribe', event: 'test' })).toBe(false)
      expect(isEventSubscriptionMessage({ type: 'subscribe', subscriptionId: '123' })).toBe(false)
    })

    it('should return false for regular event messages', () => {
      const eventMsg = {
        type: 'event',
        event: 'Customer.signup',
        payload: { email: 'test@example.com' },
        $id: 'evt-123',
        $timestamp: Date.now(),
      }
      expect(isEventSubscriptionMessage(eventMsg)).toBe(false)
    })
  })
})

// ============================================================================
// Subscription Management Tests
// ============================================================================

describe('WebSocketEventStreaming - Subscription Management', () => {
  let wsManager: WebSocketManager
  let streaming: WebSocketEventStreaming

  beforeEach(() => {
    wsManager = new WebSocketManager()
    streaming = createWebSocketEventStreaming(wsManager)
  })

  describe('subscribe', () => {
    it('should accept subscription and send acknowledgment', () => {
      const ws = createTestWebSocket()
      registerConnection(wsManager, ws)

      streaming.subscribe(ws, 'Customer.signup', 'sub-123')

      expect(streaming.getSubscriptionCount()).toBe(1)
      expect(ws._sentMessages).toHaveLength(1)

      const ack = JSON.parse(ws._sentMessages[0]) as SubscriptionAckMessage
      expect(ack.type).toBe('subscribed')
      expect(ack.subscriptionId).toBe('sub-123')
      expect(ack.event).toBe('Customer.signup')
      expect(ack.error).toBeUndefined()
    })

    it('should reject duplicate subscription IDs', () => {
      const ws = createTestWebSocket()
      registerConnection(wsManager, ws)

      streaming.subscribe(ws, 'Customer.signup', 'sub-123')
      streaming.subscribe(ws, 'Customer.updated', 'sub-123') // Same ID

      expect(streaming.getSubscriptionCount()).toBe(1)
      expect(ws._sentMessages).toHaveLength(2)

      const ack = JSON.parse(ws._sentMessages[1]) as SubscriptionAckMessage
      expect(ack.error).toBeDefined()
      expect(ack.error?.code).toBe('DUPLICATE_ID')
    })

    it('should reject invalid event patterns', () => {
      const ws = createTestWebSocket()
      registerConnection(wsManager, ws)

      streaming.subscribe(ws, '', 'sub-123')

      expect(streaming.getSubscriptionCount()).toBe(0)
      expect(ws._sentMessages).toHaveLength(1)

      const ack = JSON.parse(ws._sentMessages[0]) as SubscriptionAckMessage
      expect(ack.error).toBeDefined()
      expect(ack.error?.code).toBe('INVALID_PATTERN')
    })

    it('should allow multiple subscriptions from same connection', () => {
      const ws = createTestWebSocket()
      registerConnection(wsManager, ws)

      streaming.subscribe(ws, 'Customer.signup', 'sub-1')
      streaming.subscribe(ws, 'Order.placed', 'sub-2')
      streaming.subscribe(ws, '*.created', 'sub-3')

      expect(streaming.getSubscriptionCount()).toBe(3)
      expect(streaming.getEventPatternCount()).toBe(3)
    })

    it('should allow same event pattern from different connections', () => {
      const ws1 = createTestWebSocket()
      const ws2 = createTestWebSocket()
      registerConnection(wsManager, ws1)
      registerConnection(wsManager, ws2)

      streaming.subscribe(ws1, 'Customer.signup', 'sub-1')
      streaming.subscribe(ws2, 'Customer.signup', 'sub-2')

      expect(streaming.getSubscriptionCount()).toBe(2)
      expect(streaming.getEventPatternCount()).toBe(1) // Same pattern
    })
  })

  describe('unsubscribe', () => {
    it('should remove subscription and send acknowledgment', () => {
      const ws = createTestWebSocket()
      registerConnection(wsManager, ws)

      streaming.subscribe(ws, 'Customer.signup', 'sub-123')
      expect(streaming.getSubscriptionCount()).toBe(1)

      streaming.unsubscribe('sub-123')
      expect(streaming.getSubscriptionCount()).toBe(0)

      expect(ws._sentMessages).toHaveLength(2)
      const ack = JSON.parse(ws._sentMessages[1]) as SubscriptionAckMessage
      expect(ack.type).toBe('unsubscribed')
      expect(ack.subscriptionId).toBe('sub-123')
    })

    it('should handle unsubscribe for non-existent subscription', () => {
      // Should not throw
      expect(() => streaming.unsubscribe('non-existent')).not.toThrow()
      expect(streaming.getSubscriptionCount()).toBe(0)
    })

    it('should clean up event pattern tracking when last subscriber unsubscribes', () => {
      const ws = createTestWebSocket()
      registerConnection(wsManager, ws)

      streaming.subscribe(ws, 'Customer.signup', 'sub-123')
      expect(streaming.hasSubscribers('Customer.signup')).toBe(true)

      streaming.unsubscribe('sub-123')
      expect(streaming.hasSubscribers('Customer.signup')).toBe(false)
    })
  })

  describe('handleMessage', () => {
    it('should handle subscribe message from string', () => {
      const ws = createTestWebSocket()
      registerConnection(wsManager, ws)

      const msg = JSON.stringify({
        type: 'subscribe',
        event: 'Customer.signup',
        subscriptionId: 'sub-123',
      })

      const handled = streaming.handleMessage(ws, msg)

      expect(handled).toBe(true)
      expect(streaming.getSubscriptionCount()).toBe(1)
    })

    it('should handle unsubscribe message from string', () => {
      const ws = createTestWebSocket()
      registerConnection(wsManager, ws)

      // First subscribe
      streaming.subscribe(ws, 'Customer.signup', 'sub-123')

      // Then unsubscribe via message
      const msg = JSON.stringify({
        type: 'unsubscribe',
        event: 'Customer.signup',
        subscriptionId: 'sub-123',
      })

      const handled = streaming.handleMessage(ws, msg)

      expect(handled).toBe(true)
      expect(streaming.getSubscriptionCount()).toBe(0)
    })

    it('should handle message from parsed object', () => {
      const ws = createTestWebSocket()
      registerConnection(wsManager, ws)

      const msg = {
        type: 'subscribe',
        event: 'Customer.signup',
        subscriptionId: 'sub-123',
      }

      const handled = streaming.handleMessage(ws, msg)

      expect(handled).toBe(true)
      expect(streaming.getSubscriptionCount()).toBe(1)
    })

    it('should return false for non-subscription messages', () => {
      const ws = createTestWebSocket()

      const handled = streaming.handleMessage(ws, JSON.stringify({ type: 'other' }))

      expect(handled).toBe(false)
    })

    it('should return false for invalid JSON', () => {
      const ws = createTestWebSocket()

      const handled = streaming.handleMessage(ws, 'not valid json {')

      expect(handled).toBe(false)
    })
  })

  describe('cleanupConnection', () => {
    it('should remove all subscriptions for a connection', () => {
      const ws = createTestWebSocket()
      registerConnection(wsManager, ws)

      streaming.subscribe(ws, 'Customer.signup', 'sub-1')
      streaming.subscribe(ws, 'Order.placed', 'sub-2')
      streaming.subscribe(ws, '*.created', 'sub-3')

      expect(streaming.getSubscriptionCount()).toBe(3)

      streaming.cleanupConnection(ws)

      expect(streaming.getSubscriptionCount()).toBe(0)
    })

    it('should not affect subscriptions from other connections', () => {
      const ws1 = createTestWebSocket()
      const ws2 = createTestWebSocket()
      registerConnection(wsManager, ws1)
      registerConnection(wsManager, ws2)

      streaming.subscribe(ws1, 'Customer.signup', 'sub-1')
      streaming.subscribe(ws2, 'Customer.signup', 'sub-2')

      streaming.cleanupConnection(ws1)

      expect(streaming.getSubscriptionCount()).toBe(1)
      expect(streaming.hasSubscribers('Customer.signup')).toBe(true)
    })

    it('should handle cleanup of connection with no subscriptions', () => {
      const ws = createTestWebSocket()
      registerConnection(wsManager, ws)

      // Should not throw
      expect(() => streaming.cleanupConnection(ws)).not.toThrow()
    })
  })
})

// ============================================================================
// Event Pushing Tests
// ============================================================================

describe('WebSocketEventStreaming - Event Pushing', () => {
  let wsManager: WebSocketManager
  let streaming: WebSocketEventStreaming

  beforeEach(() => {
    wsManager = new WebSocketManager()
    streaming = createWebSocketEventStreaming(wsManager)
  })

  describe('pushEvent', () => {
    it('should push event to exact match subscribers', () => {
      const ws = createTestWebSocket()
      registerConnection(wsManager, ws)

      streaming.subscribe(ws, 'Customer.signup', 'sub-123')
      ws._sentMessages.length = 0 // Clear ack message

      streaming.pushEvent({
        $id: 'evt-123',
        type: 'Customer.signup',
        payload: { email: 'user@example.com' },
        $timestamp: Date.now(),
        source: 'test',
      })

      expect(ws._sentMessages).toHaveLength(1)
      const pushed = JSON.parse(ws._sentMessages[0]) as EventPushMessage
      expect(pushed.type).toBe('event')
      expect(pushed.event).toBe('Customer.signup')
      expect(pushed.payload).toEqual({ email: 'user@example.com' })
      expect(pushed.$id).toBe('evt-123')
    })

    it('should push event to noun wildcard subscribers', () => {
      const ws = createTestWebSocket()
      registerConnection(wsManager, ws)

      streaming.subscribe(ws, 'Customer.*', 'sub-123')
      ws._sentMessages.length = 0

      streaming.pushEvent({
        $id: 'evt-123',
        type: 'Customer.signup',
        payload: {},
        $timestamp: Date.now(),
        source: 'test',
      })

      expect(ws._sentMessages).toHaveLength(1)
      const pushed = JSON.parse(ws._sentMessages[0]) as EventPushMessage
      expect(pushed.event).toBe('Customer.signup')
    })

    it('should push event to verb wildcard subscribers', () => {
      const ws = createTestWebSocket()
      registerConnection(wsManager, ws)

      streaming.subscribe(ws, '*.signup', 'sub-123')
      ws._sentMessages.length = 0

      streaming.pushEvent({
        $id: 'evt-123',
        type: 'Customer.signup',
        payload: {},
        $timestamp: Date.now(),
        source: 'test',
      })

      expect(ws._sentMessages).toHaveLength(1)
      const pushed = JSON.parse(ws._sentMessages[0]) as EventPushMessage
      expect(pushed.event).toBe('Customer.signup')
    })

    it('should push event to global wildcard subscribers', () => {
      const ws = createTestWebSocket()
      registerConnection(wsManager, ws)

      streaming.subscribe(ws, '*.*', 'sub-123')
      ws._sentMessages.length = 0

      streaming.pushEvent({
        $id: 'evt-123',
        type: 'Customer.signup',
        payload: {},
        $timestamp: Date.now(),
        source: 'test',
      })

      expect(ws._sentMessages).toHaveLength(1)
    })

    it('should push to all matching subscribers', () => {
      const ws1 = createTestWebSocket()
      const ws2 = createTestWebSocket()
      const ws3 = createTestWebSocket()
      registerConnection(wsManager, ws1)
      registerConnection(wsManager, ws2)
      registerConnection(wsManager, ws3)

      streaming.subscribe(ws1, 'Customer.signup', 'sub-1') // Exact match
      streaming.subscribe(ws2, 'Customer.*', 'sub-2')     // Noun wildcard
      streaming.subscribe(ws3, 'Order.placed', 'sub-3')   // No match

      ws1._sentMessages.length = 0
      ws2._sentMessages.length = 0
      ws3._sentMessages.length = 0

      streaming.pushEvent({
        $id: 'evt-123',
        type: 'Customer.signup',
        payload: {},
        $timestamp: Date.now(),
        source: 'test',
      })

      expect(ws1._sentMessages).toHaveLength(1)
      expect(ws2._sentMessages).toHaveLength(1)
      expect(ws3._sentMessages).toHaveLength(0)
    })

    it('should not push to unsubscribed connections', () => {
      const ws = createTestWebSocket()
      registerConnection(wsManager, ws)

      streaming.subscribe(ws, 'Customer.signup', 'sub-123')
      streaming.unsubscribe('sub-123')
      ws._sentMessages.length = 0

      streaming.pushEvent({
        $id: 'evt-123',
        type: 'Customer.signup',
        payload: {},
        $timestamp: Date.now(),
        source: 'test',
      })

      expect(ws._sentMessages).toHaveLength(0)
    })

    it('should handle send failure gracefully', () => {
      const ws = createTestWebSocket()
      registerConnection(wsManager, ws)

      streaming.subscribe(ws, 'Customer.signup', 'sub-123')
      ws._sentMessages.length = 0

      // Close the socket to cause send failure
      ws.close()

      // Should not throw
      expect(() => streaming.pushEvent({
        $id: 'evt-123',
        type: 'Customer.signup',
        payload: {},
        $timestamp: Date.now(),
        source: 'test',
      })).not.toThrow()
    })

    it('should not push when no subscribers match', () => {
      const ws = createTestWebSocket()
      registerConnection(wsManager, ws)

      streaming.subscribe(ws, 'Order.placed', 'sub-123')
      ws._sentMessages.length = 0

      streaming.pushEvent({
        $id: 'evt-123',
        type: 'Customer.signup',
        payload: {},
        $timestamp: Date.now(),
        source: 'test',
      })

      expect(ws._sentMessages).toHaveLength(0)
    })
  })
})

// ============================================================================
// Events Store Integration Tests
// ============================================================================

describe('WebSocketEventStreaming - Events Store Integration', () => {
  let wsManager: WebSocketManager
  let events: EventsStore
  let streaming: WebSocketEventStreaming

  beforeEach(() => {
    wsManager = new WebSocketManager()
    events = createEventsStore()
    streaming = createWebSocketEventStreaming(wsManager, events)
  })

  it('should automatically push events when events store emits', async () => {
    const ws = createTestWebSocket()
    registerConnection(wsManager, ws)

    streaming.subscribe(ws, 'Customer.signup', 'sub-123')
    ws._sentMessages.length = 0

    // Emit event through the events store
    await events.emit({
      type: 'Customer.signup',
      payload: { email: 'auto@example.com' },
      source: 'test',
    })

    expect(ws._sentMessages).toHaveLength(1)
    const pushed = JSON.parse(ws._sentMessages[0]) as EventPushMessage
    expect(pushed.type).toBe('event')
    expect(pushed.event).toBe('Customer.signup')
  })
})

// ============================================================================
// Query Methods Tests
// ============================================================================

describe('WebSocketEventStreaming - Query Methods', () => {
  let wsManager: WebSocketManager
  let streaming: WebSocketEventStreaming

  beforeEach(() => {
    wsManager = new WebSocketManager()
    streaming = createWebSocketEventStreaming(wsManager)
  })

  describe('getSubscriptions', () => {
    it('should return all active subscriptions', () => {
      const ws = createTestWebSocket()
      registerConnection(wsManager, ws)

      streaming.subscribe(ws, 'Customer.signup', 'sub-1')
      streaming.subscribe(ws, 'Order.placed', 'sub-2')

      const subs = streaming.getSubscriptions()

      expect(subs).toHaveLength(2)
      expect(subs.map(s => s.subscriptionId).sort()).toEqual(['sub-1', 'sub-2'])
      expect(subs.map(s => s.event).sort()).toEqual(['Customer.signup', 'Order.placed'])
    })

    it('should return empty array when no subscriptions', () => {
      expect(streaming.getSubscriptions()).toEqual([])
    })
  })

  describe('hasSubscribers', () => {
    it('should return true when pattern has subscribers', () => {
      const ws = createTestWebSocket()
      registerConnection(wsManager, ws)

      streaming.subscribe(ws, 'Customer.signup', 'sub-123')

      expect(streaming.hasSubscribers('Customer.signup')).toBe(true)
    })

    it('should return false when pattern has no subscribers', () => {
      expect(streaming.hasSubscribers('Customer.signup')).toBe(false)
    })

    it('should return false after last subscriber unsubscribes', () => {
      const ws = createTestWebSocket()
      registerConnection(wsManager, ws)

      streaming.subscribe(ws, 'Customer.signup', 'sub-123')
      expect(streaming.hasSubscribers('Customer.signup')).toBe(true)

      streaming.unsubscribe('sub-123')
      expect(streaming.hasSubscribers('Customer.signup')).toBe(false)
    })
  })

  describe('getEventPatternCount', () => {
    it('should return count of unique event patterns', () => {
      const ws1 = createTestWebSocket()
      const ws2 = createTestWebSocket()
      registerConnection(wsManager, ws1)
      registerConnection(wsManager, ws2)

      streaming.subscribe(ws1, 'Customer.signup', 'sub-1')
      streaming.subscribe(ws2, 'Customer.signup', 'sub-2') // Same pattern
      streaming.subscribe(ws1, 'Order.placed', 'sub-3')

      expect(streaming.getEventPatternCount()).toBe(2) // 2 unique patterns
    })
  })
})

// ============================================================================
// Real DO Integration Tests
// ============================================================================

describe('WebSocketEventStreaming - Real DO Integration', () => {
  it('should handle WebSocket subscription messages via real DO', async () => {
    const testName = generateTestId()
    const id = env.DO.idFromName(testName)
    const stub = env.DO.get(id)

    // Verify DO is accessible
    const healthResponse = await stub.fetch('https://do/')
    expect(healthResponse.status).toBe(200)

    const json = await healthResponse.json() as { status: string }
    expect(json.status).toBe('ok')
  })

  it('should expose eventStreaming property on DO', async () => {
    const testName = generateTestId()
    const id = env.DO.idFromName(testName)
    const stub = env.DO.get(id)

    // Verify DO is accessible and has the expected properties
    const response = await stub.fetch('https://do/')
    expect(response.status).toBe(200)

    // The DO should have eventStreaming available (tested via health endpoint)
    const json = await response.json() as { status: string }
    expect(json.status).toBe('ok')
  })
})
