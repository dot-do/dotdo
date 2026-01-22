/**
 * WebSocket Event Streaming Tests (do-9zknf)
 *
 * Tests for remote $.on event subscriptions via WebSocket.
 * Covers both client-side (WebSocketTransport.subscribe) and
 * server-side (WebSocketEventServer) functionality.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================================
// Mock WebSocket for testing
// ============================================================================

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  url: string
  readyState = MockWebSocket.OPEN
  listeners: Record<string, Function[]> = {}

  constructor(url: string) {
    this.url = url
    // Auto-trigger open after construction
    setTimeout(() => this.emit('open', {}), 0)
  }

  addEventListener(event: string, handler: Function) {
    if (!this.listeners[event]) {
      this.listeners[event] = []
    }
    this.listeners[event].push(handler)
  }

  removeEventListener(event: string, handler: Function) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter((h) => h !== handler)
    }
  }

  emit(event: string, data: unknown) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((h) => h(data))
    }
  }

  send(data: string) {
    // Default: echo back as RPC response
    const message = JSON.parse(data)
    setTimeout(() => {
      this.emit('message', {
        data: JSON.stringify({
          id: message.id,
          result: { echo: message.method },
        }),
      })
    }, 10)
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    this.emit('close', {})
  }
}

// ============================================================================
// WebSocketTransport Event Subscription Tests
// ============================================================================

describe('WebSocketTransport event subscriptions', () => {
  /**
   * Create a MockWebSocket that handles subscription messages
   */
  class SubscriptionMockWebSocket extends MockWebSocket {
    subscriptions: Map<string, string> = new Map()

    send(data: string) {
      const message = JSON.parse(data)

      // Handle subscription messages
      if (message.type === 'subscribe') {
        this.subscriptions.set(message.subscriptionId, message.event)
        setTimeout(() => {
          this.emit('message', {
            data: JSON.stringify({
              type: 'subscribed',
              subscriptionId: message.subscriptionId,
              event: message.event,
            }),
          })
        }, 5)
        return
      }

      // Handle unsubscription messages
      if (message.type === 'unsubscribe') {
        this.subscriptions.delete(message.subscriptionId)
        setTimeout(() => {
          this.emit('message', {
            data: JSON.stringify({
              type: 'unsubscribed',
              subscriptionId: message.subscriptionId,
              event: message.event,
            }),
          })
        }, 5)
        return
      }

      // Handle regular RPC messages
      setTimeout(() => {
        this.emit('message', {
          data: JSON.stringify({
            id: message.id,
            result: { echo: message.method },
          }),
        })
      }, 10)
    }

    // Helper to simulate an event push
    pushEvent(eventType: string, payload: unknown, $id?: string) {
      this.emit('message', {
        data: JSON.stringify({
          type: 'event',
          event: eventType,
          payload,
          $id: $id ?? `event-${Date.now()}`,
          $timestamp: Date.now(),
        }),
      })
    }
  }

  describe('subscribe', () => {
    it('should subscribe to events and receive acknowledgment', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://test.example.com/ws',
        WebSocket: SubscriptionMockWebSocket as unknown as typeof WebSocket,
        autoReconnect: false,
      })

      const handler = vi.fn()
      const unsubscribe = await transport.subscribe('Customer.signup', handler)

      // Check subscription is tracked
      expect(transport.isSubscribed('Customer.signup')).toBe(true)
      expect(transport.getSubscriptions()).toContain('Customer.signup')

      // Clean up
      await unsubscribe()
      await transport.close()
    })

    it('should receive events after subscribing', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      let mockWs: SubscriptionMockWebSocket | null = null

      class CapturingWebSocket extends SubscriptionMockWebSocket {
        constructor(url: string) {
          super(url)
          mockWs = this
        }
      }

      const transport = new WebSocketTransport({
        url: 'wss://test.example.com/ws',
        WebSocket: CapturingWebSocket as unknown as typeof WebSocket,
        autoReconnect: false,
      })

      const receivedEvents: unknown[] = []
      const handler = vi.fn((event) => {
        receivedEvents.push(event)
      })

      await transport.subscribe('Customer.signup', handler)

      // Push an event from the server
      mockWs!.pushEvent('Customer.signup', { email: 'test@example.com' })

      // Wait for event to be processed
      await new Promise((r) => setTimeout(r, 20))

      expect(handler).toHaveBeenCalledTimes(1)
      expect(receivedEvents[0]).toMatchObject({
        type: 'Customer.signup',
        payload: { email: 'test@example.com' },
      })

      await transport.close()
    })

    it('should support wildcard subscriptions for noun', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      let mockWs: SubscriptionMockWebSocket | null = null

      class CapturingWebSocket extends SubscriptionMockWebSocket {
        constructor(url: string) {
          super(url)
          mockWs = this
        }
      }

      const transport = new WebSocketTransport({
        url: 'wss://test.example.com/ws',
        WebSocket: CapturingWebSocket as unknown as typeof WebSocket,
        autoReconnect: false,
      })

      const handler = vi.fn()
      await transport.subscribe('Customer.*', handler)

      // Push events
      mockWs!.pushEvent('Customer.signup', { email: 'test@example.com' })
      mockWs!.pushEvent('Customer.updated', { name: 'Alice' })
      mockWs!.pushEvent('Order.placed', { orderId: '123' }) // Should NOT match

      await new Promise((r) => setTimeout(r, 30))

      expect(handler).toHaveBeenCalledTimes(2)

      await transport.close()
    })

    it('should support wildcard subscriptions for verb', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      let mockWs: SubscriptionMockWebSocket | null = null

      class CapturingWebSocket extends SubscriptionMockWebSocket {
        constructor(url: string) {
          super(url)
          mockWs = this
        }
      }

      const transport = new WebSocketTransport({
        url: 'wss://test.example.com/ws',
        WebSocket: CapturingWebSocket as unknown as typeof WebSocket,
        autoReconnect: false,
      })

      const handler = vi.fn()
      await transport.subscribe('*.signup', handler)

      // Push events
      mockWs!.pushEvent('Customer.signup', { email: 'test@example.com' })
      mockWs!.pushEvent('User.signup', { username: 'alice' })
      mockWs!.pushEvent('Customer.updated', { name: 'Bob' }) // Should NOT match

      await new Promise((r) => setTimeout(r, 30))

      expect(handler).toHaveBeenCalledTimes(2)

      await transport.close()
    })

    it('should support global wildcard subscriptions', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      let mockWs: SubscriptionMockWebSocket | null = null

      class CapturingWebSocket extends SubscriptionMockWebSocket {
        constructor(url: string) {
          super(url)
          mockWs = this
        }
      }

      const transport = new WebSocketTransport({
        url: 'wss://test.example.com/ws',
        WebSocket: CapturingWebSocket as unknown as typeof WebSocket,
        autoReconnect: false,
      })

      const handler = vi.fn()
      await transport.subscribe('*.*', handler)

      // Push various events
      mockWs!.pushEvent('Customer.signup', {})
      mockWs!.pushEvent('Order.placed', {})
      mockWs!.pushEvent('Payment.failed', {})

      await new Promise((r) => setTimeout(r, 30))

      expect(handler).toHaveBeenCalledTimes(3)

      await transport.close()
    })
  })

  describe('unsubscribe', () => {
    it('should stop receiving events after unsubscribing', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      let mockWs: SubscriptionMockWebSocket | null = null

      class CapturingWebSocket extends SubscriptionMockWebSocket {
        constructor(url: string) {
          super(url)
          mockWs = this
        }
      }

      const transport = new WebSocketTransport({
        url: 'wss://test.example.com/ws',
        WebSocket: CapturingWebSocket as unknown as typeof WebSocket,
        autoReconnect: false,
      })

      const handler = vi.fn()
      const unsubscribe = await transport.subscribe('Customer.signup', handler)

      // Push an event
      mockWs!.pushEvent('Customer.signup', { before: true })
      await new Promise((r) => setTimeout(r, 20))
      expect(handler).toHaveBeenCalledTimes(1)

      // Unsubscribe
      await unsubscribe()

      // Push another event
      mockWs!.pushEvent('Customer.signup', { after: true })
      await new Promise((r) => setTimeout(r, 20))

      // Should still be 1 (no new calls)
      expect(handler).toHaveBeenCalledTimes(1)
      expect(transport.isSubscribed('Customer.signup')).toBe(false)

      await transport.close()
    })
  })

  describe('reconnection', () => {
    it('should resubscribe after reconnection', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      let connectionCount = 0
      let mockWs: SubscriptionMockWebSocket | null = null

      class ReconnectingWebSocket extends SubscriptionMockWebSocket {
        constructor(url: string) {
          super(url)
          connectionCount++
          mockWs = this

          // First connection succeeds
          if (connectionCount === 1) {
            setTimeout(() => this.emit('open', {}), 5)
          } else {
            // Subsequent connections also succeed
            setTimeout(() => this.emit('open', {}), 5)
          }
        }
      }

      const transport = new WebSocketTransport({
        url: 'wss://test.example.com/ws',
        WebSocket: ReconnectingWebSocket as unknown as typeof WebSocket,
        autoReconnect: true,
        reconnectDelay: 10,
        maxReconnectAttempts: 3,
      })

      const handler = vi.fn()
      await transport.subscribe('Customer.signup', handler)

      // Verify initial subscription
      expect(mockWs!.subscriptions.size).toBe(1)

      // Simulate disconnect
      mockWs!.emit('close', {})

      // Wait for reconnection and resubscription
      await new Promise((r) => setTimeout(r, 100))

      // Verify resubscription happened (new mockWs should have the subscription)
      expect(connectionCount).toBeGreaterThanOrEqual(2)
      expect(mockWs!.subscriptions.size).toBe(1)

      await transport.close()
    })
  })

  describe('multiple subscriptions', () => {
    it('should handle multiple subscriptions independently', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      let mockWs: SubscriptionMockWebSocket | null = null

      class CapturingWebSocket extends SubscriptionMockWebSocket {
        constructor(url: string) {
          super(url)
          mockWs = this
        }
      }

      const transport = new WebSocketTransport({
        url: 'wss://test.example.com/ws',
        WebSocket: CapturingWebSocket as unknown as typeof WebSocket,
        autoReconnect: false,
      })

      const customerHandler = vi.fn()
      const orderHandler = vi.fn()

      const unsub1 = await transport.subscribe('Customer.signup', customerHandler)
      const unsub2 = await transport.subscribe('Order.placed', orderHandler)

      expect(transport.getSubscriptions()).toHaveLength(2)

      // Push events
      mockWs!.pushEvent('Customer.signup', { email: 'test@example.com' })
      mockWs!.pushEvent('Order.placed', { orderId: '123' })

      await new Promise((r) => setTimeout(r, 30))

      expect(customerHandler).toHaveBeenCalledTimes(1)
      expect(orderHandler).toHaveBeenCalledTimes(1)

      // Unsubscribe from one
      await unsub1()

      expect(transport.getSubscriptions()).toHaveLength(1)
      expect(transport.isSubscribed('Customer.signup')).toBe(false)
      expect(transport.isSubscribed('Order.placed')).toBe(true)

      await unsub2()
      await transport.close()
    })
  })

  describe('error handling', () => {
    it('should handle handler errors gracefully', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      let mockWs: SubscriptionMockWebSocket | null = null

      class CapturingWebSocket extends SubscriptionMockWebSocket {
        constructor(url: string) {
          super(url)
          mockWs = this
        }
      }

      const transport = new WebSocketTransport({
        url: 'wss://test.example.com/ws',
        WebSocket: CapturingWebSocket as unknown as typeof WebSocket,
        autoReconnect: false,
      })

      const errorHandler = vi.fn(() => {
        throw new Error('Handler error')
      })

      const goodHandler = vi.fn()

      await transport.subscribe('Customer.signup', errorHandler)
      await transport.subscribe('Customer.signup', goodHandler)

      // Push an event
      mockWs!.pushEvent('Customer.signup', {})

      await new Promise((r) => setTimeout(r, 20))

      // Both handlers should have been called (error in one shouldn't stop others)
      expect(errorHandler).toHaveBeenCalledTimes(1)
      expect(goodHandler).toHaveBeenCalledTimes(1)

      await transport.close()
    })
  })
})

// ============================================================================
// WebSocketEventServer Tests
// ============================================================================

describe('WebSocketEventServer', () => {
  /**
   * Create a mock WebSocket for server-side testing
   */
  function createMockServerWebSocket(): WebSocket {
    const sentMessages: string[] = []
    return {
      readyState: 1, // OPEN
      send: vi.fn((data: string) => {
        sentMessages.push(data)
      }),
      close: vi.fn(),
      // Helper to access sent messages
      _sentMessages: sentMessages,
    } as unknown as WebSocket & { _sentMessages: string[] }
  }

  describe('registerClient', () => {
    it('should register a client and return client ID', async () => {
      const { WebSocketEventServer } = await import('../websocket-events')

      const server = new WebSocketEventServer()
      const ws = createMockServerWebSocket()

      const clientId = server.registerClient(ws)

      expect(clientId).toBeDefined()
      expect(typeof clientId).toBe('string')
      expect(server.getClientCount()).toBe(1)
    })

    it('should call onClientConnect callback', async () => {
      const { WebSocketEventServer } = await import('../websocket-events')

      const onClientConnect = vi.fn()
      const server = new WebSocketEventServer({ onClientConnect })
      const ws = createMockServerWebSocket()

      server.registerClient(ws)

      await new Promise((r) => setTimeout(r, 10))

      expect(onClientConnect).toHaveBeenCalledTimes(1)
    })
  })

  describe('unregisterClient', () => {
    it('should unregister a client', async () => {
      const { WebSocketEventServer } = await import('../websocket-events')

      const server = new WebSocketEventServer()
      const ws = createMockServerWebSocket()

      server.registerClient(ws)
      expect(server.getClientCount()).toBe(1)

      server.unregisterClient(ws)
      expect(server.getClientCount()).toBe(0)
    })

    it('should call onClientDisconnect callback', async () => {
      const { WebSocketEventServer } = await import('../websocket-events')

      const onClientDisconnect = vi.fn()
      const server = new WebSocketEventServer({ onClientDisconnect })
      const ws = createMockServerWebSocket()

      server.registerClient(ws)
      server.unregisterClient(ws)

      await new Promise((r) => setTimeout(r, 10))

      expect(onClientDisconnect).toHaveBeenCalledTimes(1)
    })
  })

  describe('handleMessage', () => {
    it('should handle subscribe message and send acknowledgment', async () => {
      const { WebSocketEventServer } = await import('../websocket-events')

      const server = new WebSocketEventServer()
      const ws = createMockServerWebSocket() as WebSocket & { _sentMessages: string[] }

      server.registerClient(ws)

      const subscribeMessage = JSON.stringify({
        type: 'subscribe',
        event: 'Customer.signup',
        subscriptionId: 'sub-123',
      })

      const handled = server.handleMessage(ws, subscribeMessage)

      expect(handled).toBe(true)
      expect(ws._sentMessages.length).toBe(1)

      const ack = JSON.parse(ws._sentMessages[0])
      expect(ack.type).toBe('subscribed')
      expect(ack.subscriptionId).toBe('sub-123')
      expect(ack.event).toBe('Customer.signup')
    })

    it('should handle unsubscribe message', async () => {
      const { WebSocketEventServer } = await import('../websocket-events')

      const server = new WebSocketEventServer()
      const ws = createMockServerWebSocket() as WebSocket & { _sentMessages: string[] }

      server.registerClient(ws)

      // First subscribe
      server.handleMessage(
        ws,
        JSON.stringify({
          type: 'subscribe',
          event: 'Customer.signup',
          subscriptionId: 'sub-123',
        })
      )

      // Then unsubscribe
      server.handleMessage(
        ws,
        JSON.stringify({
          type: 'unsubscribe',
          event: 'Customer.signup',
          subscriptionId: 'sub-123',
        })
      )

      expect(ws._sentMessages.length).toBe(2)

      const ack = JSON.parse(ws._sentMessages[1])
      expect(ack.type).toBe('unsubscribed')
      expect(ack.subscriptionId).toBe('sub-123')
    })

    it('should return false for non-subscription messages', async () => {
      const { WebSocketEventServer } = await import('../websocket-events')

      const server = new WebSocketEventServer()
      const ws = createMockServerWebSocket()

      server.registerClient(ws)

      // RPC message (not a subscription)
      const rpcMessage = JSON.stringify({
        id: 'rpc-123',
        method: 'greet',
        args: ['World'],
      })

      const handled = server.handleMessage(ws, rpcMessage)

      expect(handled).toBe(false)
    })
  })

  describe('broadcast', () => {
    it('should broadcast to subscribed clients', async () => {
      const { WebSocketEventServer } = await import('../websocket-events')

      const server = new WebSocketEventServer()
      const ws1 = createMockServerWebSocket() as WebSocket & { _sentMessages: string[] }
      const ws2 = createMockServerWebSocket() as WebSocket & { _sentMessages: string[] }

      server.registerClient(ws1)
      server.registerClient(ws2)

      // ws1 subscribes to Customer.signup
      server.handleMessage(
        ws1,
        JSON.stringify({
          type: 'subscribe',
          event: 'Customer.signup',
          subscriptionId: 'sub-1',
        })
      )

      // ws2 subscribes to Order.placed
      server.handleMessage(
        ws2,
        JSON.stringify({
          type: 'subscribe',
          event: 'Order.placed',
          subscriptionId: 'sub-2',
        })
      )

      // Broadcast Customer.signup
      const sentCount = server.broadcast('Customer.signup', { email: 'test@example.com' })

      expect(sentCount).toBe(1)
      // ws1 should have received: ack + event
      expect(ws1._sentMessages.length).toBe(2)
      // ws2 should have received: ack only
      expect(ws2._sentMessages.length).toBe(1)

      const event = JSON.parse(ws1._sentMessages[1])
      expect(event.type).toBe('event')
      expect(event.event).toBe('Customer.signup')
      expect(event.payload).toEqual({ email: 'test@example.com' })
    })

    it('should support wildcard subscriptions when broadcasting', async () => {
      const { WebSocketEventServer } = await import('../websocket-events')

      const server = new WebSocketEventServer()
      const ws = createMockServerWebSocket() as WebSocket & { _sentMessages: string[] }

      server.registerClient(ws)

      // Subscribe to wildcard
      server.handleMessage(
        ws,
        JSON.stringify({
          type: 'subscribe',
          event: 'Customer.*',
          subscriptionId: 'sub-1',
        })
      )

      // Broadcast specific event
      server.broadcast('Customer.signup', {})
      server.broadcast('Customer.updated', {})
      server.broadcast('Order.placed', {}) // Should NOT match

      // ws should have: ack + 2 events
      expect(ws._sentMessages.length).toBe(3)
    })

    it('should support global wildcard', async () => {
      const { WebSocketEventServer } = await import('../websocket-events')

      const server = new WebSocketEventServer()
      const ws = createMockServerWebSocket() as WebSocket & { _sentMessages: string[] }

      server.registerClient(ws)

      // Subscribe to global wildcard
      server.handleMessage(
        ws,
        JSON.stringify({
          type: 'subscribe',
          event: '*.*',
          subscriptionId: 'sub-1',
        })
      )

      // Broadcast various events
      server.broadcast('Customer.signup', {})
      server.broadcast('Order.placed', {})
      server.broadcast('Payment.failed', {})

      // ws should have: ack + 3 events
      expect(ws._sentMessages.length).toBe(4)
    })
  })

  describe('hasSubscribers', () => {
    it('should return true if there are subscribers', async () => {
      const { WebSocketEventServer } = await import('../websocket-events')

      const server = new WebSocketEventServer()
      const ws = createMockServerWebSocket()

      server.registerClient(ws)

      // Subscribe
      server.handleMessage(
        ws,
        JSON.stringify({
          type: 'subscribe',
          event: 'Customer.signup',
          subscriptionId: 'sub-1',
        })
      )

      expect(server.hasSubscribers('Customer.signup')).toBe(true)
      expect(server.hasSubscribers('Order.placed')).toBe(false)
    })

    it('should consider wildcards when checking subscribers', async () => {
      const { WebSocketEventServer } = await import('../websocket-events')

      const server = new WebSocketEventServer()
      const ws = createMockServerWebSocket()

      server.registerClient(ws)

      // Subscribe to wildcard
      server.handleMessage(
        ws,
        JSON.stringify({
          type: 'subscribe',
          event: 'Customer.*',
          subscriptionId: 'sub-1',
        })
      )

      expect(server.hasSubscribers('Customer.signup')).toBe(true)
      expect(server.hasSubscribers('Customer.updated')).toBe(true)
      expect(server.hasSubscribers('Order.placed')).toBe(false)
    })
  })

  describe('getActiveSubscriptions', () => {
    it('should return all unique subscription patterns', async () => {
      const { WebSocketEventServer } = await import('../websocket-events')

      const server = new WebSocketEventServer()
      const ws1 = createMockServerWebSocket()
      const ws2 = createMockServerWebSocket()

      server.registerClient(ws1)
      server.registerClient(ws2)

      // Multiple subscriptions
      server.handleMessage(
        ws1,
        JSON.stringify({ type: 'subscribe', event: 'Customer.signup', subscriptionId: 'sub-1' })
      )
      server.handleMessage(
        ws1,
        JSON.stringify({ type: 'subscribe', event: 'Order.placed', subscriptionId: 'sub-2' })
      )
      server.handleMessage(
        ws2,
        JSON.stringify({ type: 'subscribe', event: 'Customer.signup', subscriptionId: 'sub-3' })
      )

      const patterns = server.getActiveSubscriptions()

      expect(patterns).toHaveLength(2)
      expect(patterns).toContain('Customer.signup')
      expect(patterns).toContain('Order.placed')
    })
  })

  describe('getSubscriptionCount', () => {
    it('should return count for a specific pattern', async () => {
      const { WebSocketEventServer } = await import('../websocket-events')

      const server = new WebSocketEventServer()
      const ws1 = createMockServerWebSocket()
      const ws2 = createMockServerWebSocket()

      server.registerClient(ws1)
      server.registerClient(ws2)

      // Both subscribe to same pattern
      server.handleMessage(
        ws1,
        JSON.stringify({ type: 'subscribe', event: 'Customer.signup', subscriptionId: 'sub-1' })
      )
      server.handleMessage(
        ws2,
        JSON.stringify({ type: 'subscribe', event: 'Customer.signup', subscriptionId: 'sub-2' })
      )

      expect(server.getSubscriptionCount('Customer.signup')).toBe(2)
      expect(server.getSubscriptionCount('Order.placed')).toBe(0)
    })
  })
})
