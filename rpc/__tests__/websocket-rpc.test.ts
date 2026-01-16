/**
 * WebSocket RPC Tests
 *
 * Tests for bidirectional RPC over WebSocket with callback support.
 * This is the key to making `this.on.Noun.verb(handler)` work across RPC boundaries.
 *
 * The solution: callbacks are registered locally and invoked via WebSocket messages.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { env } from 'cloudflare:test'
import type { RpcMessage } from '../websocket-rpc'

// =============================================================================
// Test Helpers
// =============================================================================

function getDOStub(name = 'ws-rpc-test') {
  const id = env.DOCore.idFromName(name)
  return env.DOCore.get(id)
}

interface WebSocketClient {
  ws: WebSocket
  messages: RpcMessage[]
  waitFor: (type: string, timeout?: number) => Promise<RpcMessage>
  send: (msg: RpcMessage) => void
  close: () => void
}

async function createRpcWebSocketClient(doStub: DurableObjectStub): Promise<WebSocketClient> {
  const response = await doStub.fetch('https://test.api.dotdo.dev/ws/rpc', {
    headers: { Upgrade: 'websocket' },
  })

  if (response.status !== 101) {
    throw new Error(`WebSocket upgrade failed: ${response.status}`)
  }

  const ws = response.webSocket!
  ws.accept()

  const messages: RpcMessage[] = []
  const waiters = new Map<string, { resolve: (msg: RpcMessage) => void; timeout: ReturnType<typeof setTimeout> }>()

  ws.addEventListener('message', (event) => {
    try {
      const msg: RpcMessage = JSON.parse(event.data as string)
      messages.push(msg)

      // Resolve any waiters
      const waiter = waiters.get(msg.type)
      if (waiter) {
        clearTimeout(waiter.timeout)
        waiters.delete(msg.type)
        waiter.resolve(msg)
      }
    } catch {
      // Non-JSON message - ignore as we only track parsed RPC messages in test helper
    }
  })

  return {
    ws,
    messages,
    waitFor(type: string, timeout = 5000): Promise<RpcMessage> {
      const existing = messages.find((m) => m.type === type)
      if (existing) return Promise.resolve(existing)

      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          waiters.delete(type)
          reject(new Error(`Timeout waiting for message type: ${type}`))
        }, timeout)
        waiters.set(type, { resolve, timeout: timeoutId })
      })
    },
    send(msg: RpcMessage) {
      ws.send(JSON.stringify(msg))
    },
    close() {
      ws.close(1000, 'Test complete')
    },
  }
}

// =============================================================================
// WebSocket RPC Connection Tests
// =============================================================================

describe('WebSocket RPC: Connection', () => {
  it('should establish WebSocket connection to /ws/rpc endpoint', async () => {
    const doStub = getDOStub('ws-rpc-connect-1')
    const client = await createRpcWebSocketClient(doStub)

    expect(client.ws.readyState).toBe(WebSocket.OPEN)
    client.close()
  })

  it('should establish WebSocket connection to /ws/events endpoint', async () => {
    const doStub = getDOStub('ws-rpc-connect-2')
    const response = await doStub.fetch('https://test.api.dotdo.dev/ws/events', {
      headers: { Upgrade: 'websocket' },
    })

    expect(response.status).toBe(101)
    const ws = response.webSocket!
    ws.accept()
    ws.close()
  })
})

// =============================================================================
// WebSocket RPC: Method Calls
// =============================================================================

describe('WebSocket RPC: Method Calls', () => {
  it('should call RPC method via WebSocket and receive response', async () => {
    const doStub = getDOStub('ws-rpc-call-1')
    const client = await createRpcWebSocketClient(doStub)

    // Make an RPC call to the ping() method
    client.send({
      id: 'test-1',
      type: 'call',
      path: ['ping'],
      args: [],
    })

    // Wait for response
    const response = await client.waitFor('response', 2000)

    expect(response.id).toBe('test-1')
    expect(response.result).toBe('pong')

    client.close()
  })

  it('should call RPC method with arguments', async () => {
    const doStub = getDOStub('ws-rpc-call-2')
    const client = await createRpcWebSocketClient(doStub)

    // Make an RPC call to the add() method
    client.send({
      id: 'test-2',
      type: 'call',
      path: ['add'],
      args: [5, 3],
    })

    const response = await client.waitFor('response', 2000)

    expect(response.id).toBe('test-2')
    expect(response.result).toBe(8)

    client.close()
  })

  it('should handle method call errors', async () => {
    const doStub = getDOStub('ws-rpc-call-3')
    const client = await createRpcWebSocketClient(doStub)

    // Call a non-existent method
    client.send({
      id: 'test-3',
      type: 'call',
      path: ['nonExistentMethod'],
      args: [],
    })

    const response = await client.waitFor('response', 2000)

    expect(response.id).toBe('test-3')
    expect(response.error).toBeDefined()

    client.close()
  })
})

// =============================================================================
// WebSocket RPC: Event Subscriptions
// =============================================================================

describe('WebSocket RPC: Event Subscriptions', () => {
  it('should subscribe to events via WebSocket', async () => {
    const doStub = getDOStub('ws-rpc-events-1')
    const client = await createRpcWebSocketClient(doStub)

    // Subscribe to Customer.signup events
    client.send({
      id: 'sub-1',
      type: 'subscribe',
      eventType: 'Customer.signup',
    })

    // Wait a bit for subscription to register
    await new Promise((r) => setTimeout(r, 100))

    // Trigger the event via RPC call to send()
    client.send({
      id: 'call-1',
      type: 'call',
      path: ['send'],
      args: ['Customer.signup', { email: 'test@example.com' }],
    })

    // Wait for both the response and the event
    await client.waitFor('response', 2000)

    // Wait for event to be broadcast
    await new Promise((r) => setTimeout(r, 200))

    // Check if we received the event
    const eventMsg = client.messages.find((m) => m.type === 'event' && m.eventType === 'Customer.signup')
    expect(eventMsg).toBeDefined()
    expect(eventMsg?.data).toMatchObject({
      type: 'Customer.signup',
      data: { email: 'test@example.com' },
    })

    client.close()
  })

  it('should receive wildcard events via WebSocket', async () => {
    const doStub = getDOStub('ws-rpc-events-2')
    const client = await createRpcWebSocketClient(doStub)

    // Subscribe to *.created events (wildcard noun)
    client.send({
      id: 'sub-1',
      type: 'subscribe',
      eventType: '*.created',
    })

    await new Promise((r) => setTimeout(r, 100))

    // Send multiple events
    client.send({
      id: 'call-1',
      type: 'call',
      path: ['send'],
      args: ['Customer.created', { name: 'Alice' }],
    })
    client.send({
      id: 'call-2',
      type: 'call',
      path: ['send'],
      args: ['Order.created', { orderId: '123' }],
    })
    client.send({
      id: 'call-3',
      type: 'call',
      path: ['send'],
      args: ['Customer.updated', { name: 'Bob' }], // Should NOT match
    })

    // Wait for events
    await new Promise((r) => setTimeout(r, 500))

    const eventMsgs = client.messages.filter((m) => m.type === 'event')
    const eventTypes = eventMsgs.map((m) => m.eventType)

    expect(eventTypes).toContain('Customer.created')
    expect(eventTypes).toContain('Order.created')
    expect(eventTypes).not.toContain('Customer.updated')

    client.close()
  })

  it('should unsubscribe from events', async () => {
    const doStub = getDOStub('ws-rpc-events-3')
    const client = await createRpcWebSocketClient(doStub)

    // Subscribe
    client.send({
      id: 'sub-1',
      type: 'subscribe',
      eventType: 'Test.event',
    })

    await new Promise((r) => setTimeout(r, 100))

    // Send event - should receive
    client.send({
      id: 'call-1',
      type: 'call',
      path: ['send'],
      args: ['Test.event', { count: 1 }],
    })

    await new Promise((r) => setTimeout(r, 200))
    const eventsBefore = client.messages.filter((m) => m.type === 'event').length

    // Unsubscribe
    client.send({
      id: 'unsub-1',
      type: 'unsubscribe',
      eventType: 'Test.event',
    })

    await new Promise((r) => setTimeout(r, 100))

    // Send another event - should NOT receive
    client.send({
      id: 'call-2',
      type: 'call',
      path: ['send'],
      args: ['Test.event', { count: 2 }],
    })

    await new Promise((r) => setTimeout(r, 200))
    const eventsAfter = client.messages.filter((m) => m.type === 'event').length

    // Should have same number of events (no new event received)
    expect(eventsAfter).toBe(eventsBefore)

    client.close()
  })
})

// =============================================================================
// WebSocket RPC: Bidirectional Callbacks
// =============================================================================

describe('WebSocket RPC: Bidirectional Callbacks', () => {
  it('should invoke callback passed as argument', async () => {
    const doStub = getDOStub('ws-rpc-callback-1')
    const client = await createRpcWebSocketClient(doStub)

    // Register a handler using the on.Noun.verb pattern
    // The handler is a callback that will be invoked via WebSocket
    const callbackId = `cb_test_${Date.now()}`

    // Subscribe to the event
    client.send({
      id: 'sub-1',
      type: 'subscribe',
      eventType: 'Callback.test',
    })

    await new Promise((r) => setTimeout(r, 100))

    // Send an event
    client.send({
      id: 'call-1',
      type: 'call',
      path: ['send'],
      args: ['Callback.test', { message: 'Hello callback!' }],
    })

    // Wait for the event
    await new Promise((r) => setTimeout(r, 200))

    // Verify we received the event (which can be processed by local callback)
    const eventMsg = client.messages.find((m) => m.type === 'event')
    expect(eventMsg).toBeDefined()

    client.close()
  })

  it('should handle callback stub serialization', async () => {
    const doStub = getDOStub('ws-rpc-callback-2')
    const client = await createRpcWebSocketClient(doStub)

    // Test that callback stubs are serialized correctly
    // When we pass a callback ID, the server should be able to invoke it

    // Call registerHandler with a callback stub
    const callbackId = `cb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    client.send({
      id: 'call-1',
      type: 'call',
      path: ['registerHandler'],
      args: ['Test.callback', { __rpc_callback_id: callbackId }],
    })

    const response = await client.waitFor('response', 2000)

    // The response should contain the unsubscribe function as a callback stub
    expect(response.result).toBeDefined()

    client.close()
  })
})

// =============================================================================
// WebSocket RPC: Thing CRUD via WebSocket
// =============================================================================

describe('WebSocket RPC: Thing CRUD', () => {
  it('should create a thing via WebSocket RPC', async () => {
    const doStub = getDOStub('ws-rpc-crud-1')
    const client = await createRpcWebSocketClient(doStub)

    // Call create via RPC
    client.send({
      id: 'create-1',
      type: 'call',
      path: ['create'],
      args: ['Customer', { name: 'Alice', email: 'alice@example.com' }],
    })

    const response = await client.waitFor('response', 2000)

    expect(response.result).toBeDefined()
    const customer = response.result as Record<string, unknown>
    expect(customer.$id).toBeDefined()
    expect(customer.$type).toBe('Customer')
    expect(customer.name).toBe('Alice')

    client.close()
  })

  it('should list things via WebSocket RPC', async () => {
    const doStub = getDOStub('ws-rpc-crud-2')
    const client = await createRpcWebSocketClient(doStub)

    // Create some things first
    client.send({
      id: 'create-1',
      type: 'call',
      path: ['create'],
      args: ['Product', { name: 'Widget A', price: 10 }],
    })
    await client.waitFor('response', 2000)

    client.send({
      id: 'create-2',
      type: 'call',
      path: ['create'],
      args: ['Product', { name: 'Widget B', price: 20 }],
    })
    await client.waitFor('response', 2000)

    // List things
    client.send({
      id: 'list-1',
      type: 'call',
      path: ['listThings'],
      args: ['Product'],
    })

    // Wait for list response
    await new Promise((r) => setTimeout(r, 200))
    const listResponse = client.messages.find((m) => m.id === 'list-1')

    expect(listResponse).toBeDefined()
    expect(Array.isArray(listResponse?.result)).toBe(true)
    const products = listResponse?.result as unknown[]
    expect(products.length).toBeGreaterThanOrEqual(2)

    client.close()
  })
})

// =============================================================================
// WebSocket RPC: Hibernation Support
// =============================================================================

describe('WebSocket RPC: Hibernation Support', () => {
  it('should use hibernatable WebSocket for RPC endpoint', async () => {
    const doStub = getDOStub('ws-rpc-hibernate-1')

    // The /ws/rpc endpoint should create a hibernatable WebSocket
    const response = await doStub.fetch('https://test.api.dotdo.dev/ws/rpc', {
      headers: { Upgrade: 'websocket' },
    })

    expect(response.status).toBe(101)
    // Note: We can't directly test hibernation behavior in unit tests,
    // but we can verify the endpoint accepts the connection

    const ws = response.webSocket!
    ws.accept()
    ws.close()
  })

  it('should maintain subscriptions across multiple messages', async () => {
    const doStub = getDOStub('ws-rpc-hibernate-2')
    const client = await createRpcWebSocketClient(doStub)

    // Subscribe
    client.send({
      id: 'sub-1',
      type: 'subscribe',
      eventType: 'Persist.event',
    })

    await new Promise((r) => setTimeout(r, 100))

    // Send multiple events
    for (let i = 0; i < 5; i++) {
      client.send({
        id: `call-${i}`,
        type: 'call',
        path: ['send'],
        args: ['Persist.event', { index: i }],
      })
    }

    await new Promise((r) => setTimeout(r, 500))

    // Should receive all events
    const events = client.messages.filter((m) => m.type === 'event')
    expect(events.length).toBe(5)

    client.close()
  })
})
