/**
 * RPC obs.subscribe WebSocket Method Tests
 *
 * Tests for real-time observability subscriptions via RPC WebSocket.
 * These tests verify the obs.subscribe method that connects clients
 * to the ObservabilityBroadcaster DO for streaming observability events.
 *
 * NOTE: These tests require @cloudflare/vitest-pool-workers to run.
 * They will be skipped if the cloudflare:test module is not available.
 *
 * @see objects/ObservabilityBroadcaster.ts - The DO that handles WebSocket connections
 * @see types/observability.ts - ObsFilter and ObservabilityEvent types
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ObsFilter, ObservabilityEvent } from '../../../types/observability'

// Try to import cloudflare:test, skip all tests if not available
// This happens when vitest is not running with @cloudflare/vitest-pool-workers
let env: { OBS_BROADCASTER: DurableObjectNamespace } | undefined
let SELF: { fetch: (url: string, init?: RequestInit) => Promise<Response> } | undefined
let cloudflareTestAvailable = false

try {
  // Dynamic import to avoid module resolution errors when not in workers pool
  const cloudflareTest = await import('cloudflare:test')
  env = cloudflareTest.env as typeof env
  SELF = cloudflareTest.SELF as typeof SELF
  cloudflareTestAvailable = true
} catch {
  // cloudflare:test not available, tests will be skipped
}

// Use describe.skipIf to skip all tests when cloudflare:test is not available
const describeWithWorkers = cloudflareTestAvailable ? describe : describe.skip

// ============================================================================
// Types for RPC Observability Protocol
// ============================================================================

/**
 * JSON-RPC 2.0 request format for obs.subscribe
 */
interface ObsSubscribeRequest {
  jsonrpc: '2.0'
  method: 'obs.subscribe'
  params: {
    filter?: ObsFilter
  }
  id: string | number
}

/**
 * JSON-RPC 2.0 response for obs.subscribe
 * Returns a WebSocket connection or subscription ID
 */
interface ObsSubscribeResponse {
  jsonrpc: '2.0'
  result?: {
    subscriptionId: string
    filter: ObsFilter
  }
  error?: {
    code: number
    message: string
    data?: unknown
  }
  id: string | number | null
}

/**
 * JSON-RPC 2.0 request for updating subscription filter
 */
interface ObsUpdateFilterRequest {
  jsonrpc: '2.0'
  method: 'obs.updateFilter'
  params: {
    subscriptionId: string
    filter: ObsFilter
  }
  id: string | number
}

/**
 * JSON-RPC 2.0 request for unsubscribing
 */
interface ObsUnsubscribeRequest {
  jsonrpc: '2.0'
  method: 'obs.unsubscribe'
  params: {
    subscriptionId: string
  }
  id: string | number
}

/**
 * WebSocket message types for observability events
 */
interface ObsEventMessage {
  type: 'events'
  data: ObservabilityEvent[]
}

interface ObsAckMessage {
  type: 'subscribed'
  subscriptionId: string
  filter: ObsFilter
}

interface ObsFilterUpdatedMessage {
  type: 'filter_updated'
  subscriptionId: string
  filter: ObsFilter
}

type ObsWebSocketMessage = ObsEventMessage | ObsAckMessage | ObsFilterUpdatedMessage

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a sample observability event for testing
 */
function createObsEvent(overrides: Partial<ObservabilityEvent> = {}): ObservabilityEvent {
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
 * Create obs.subscribe request
 */
function createSubscribeRequest(filter?: ObsFilter, id?: string | number): ObsSubscribeRequest {
  return {
    jsonrpc: '2.0',
    method: 'obs.subscribe',
    params: { filter: filter || {} },
    id: id ?? crypto.randomUUID(),
  }
}

/**
 * Create obs.updateFilter request
 */
function createUpdateFilterRequest(
  subscriptionId: string,
  filter: ObsFilter,
  id?: string | number
): ObsUpdateFilterRequest {
  return {
    jsonrpc: '2.0',
    method: 'obs.updateFilter',
    params: { subscriptionId, filter },
    id: id ?? crypto.randomUUID(),
  }
}

/**
 * Create obs.unsubscribe request
 */
function createUnsubscribeRequest(subscriptionId: string, id?: string | number): ObsUnsubscribeRequest {
  return {
    jsonrpc: '2.0',
    method: 'obs.unsubscribe',
    params: { subscriptionId },
    id: id ?? crypto.randomUUID(),
  }
}

/**
 * Helper to wait for a WebSocket message with timeout
 */
function waitForMessage<T>(
  ws: WebSocket,
  predicate: (msg: unknown) => msg is T,
  timeout = 5000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for message after ${timeout}ms`))
    }, timeout)

    const handler = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string)
        if (predicate(data)) {
          clearTimeout(timer)
          ws.removeEventListener('message', handler)
          resolve(data)
        }
      } catch {
        // Ignore parse errors
      }
    }

    ws.addEventListener('message', handler)
  })
}

/**
 * Type guard for subscription acknowledgment
 */
function isSubscriptionAck(msg: unknown): msg is ObsAckMessage {
  return (
    msg !== null &&
    typeof msg === 'object' &&
    'type' in msg &&
    (msg as ObsAckMessage).type === 'subscribed'
  )
}

/**
 * Type guard for events message
 */
function isEventsMessage(msg: unknown): msg is ObsEventMessage {
  return (
    msg !== null &&
    typeof msg === 'object' &&
    'type' in msg &&
    (msg as ObsEventMessage).type === 'events'
  )
}

/**
 * Type guard for filter updated message
 */
function isFilterUpdatedMessage(msg: unknown): msg is ObsFilterUpdatedMessage {
  return (
    msg !== null &&
    typeof msg === 'object' &&
    'type' in msg &&
    (msg as ObsFilterUpdatedMessage).type === 'filter_updated'
  )
}

/**
 * Type guard for JSON-RPC response
 */
function isJSONRPCResponse(msg: unknown): msg is ObsSubscribeResponse {
  return (
    msg !== null &&
    typeof msg === 'object' &&
    'jsonrpc' in msg &&
    (msg as ObsSubscribeResponse).jsonrpc === '2.0'
  )
}

// ============================================================================
// 1. obs.subscribe WebSocket Connection Tests
// ============================================================================

describeWithWorkers('obs.subscribe - WebSocket Connection', () => {
  it('should accept obs.subscribe request and establish subscription', async () => {
    // Upgrade to WebSocket on /rpc
    const response = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    expect(response.status).toBe(101)
    expect(response.webSocket).toBeDefined()

    const ws = response.webSocket!
    ws.accept()

    // Send obs.subscribe request
    const subscribeRequest = createSubscribeRequest({})
    ws.send(JSON.stringify(subscribeRequest))

    // Wait for subscription acknowledgment response
    const ack = await waitForMessage(ws, isJSONRPCResponse, 3000)

    expect(ack.id).toBe(subscribeRequest.id)
    expect(ack.result).toBeDefined()
    expect(ack.result?.subscriptionId).toBeDefined()
    expect(typeof ack.result?.subscriptionId).toBe('string')

    ws.close()
  })

  it('should accept obs.subscribe with filter parameter', async () => {
    const response = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    expect(response.status).toBe(101)
    const ws = response.webSocket!
    ws.accept()

    // Subscribe with a specific filter
    const filter: ObsFilter = { level: 'error', script: 'api-worker' }
    const subscribeRequest = createSubscribeRequest(filter)
    ws.send(JSON.stringify(subscribeRequest))

    const ack = await waitForMessage(ws, isJSONRPCResponse, 3000)

    expect(ack.result).toBeDefined()
    expect(ack.result?.filter).toEqual(filter)

    ws.close()
  })

  it('should return error for invalid filter parameters', async () => {
    const response = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    expect(response.status).toBe(101)
    const ws = response.webSocket!
    ws.accept()

    // Send invalid filter (unknown field)
    const invalidRequest = {
      jsonrpc: '2.0',
      method: 'obs.subscribe',
      params: {
        filter: { invalidField: 'test' } as unknown as ObsFilter,
      },
      id: 'invalid-filter-test',
    }
    ws.send(JSON.stringify(invalidRequest))

    const errorResponse = await waitForMessage(ws, isJSONRPCResponse, 3000)

    expect(errorResponse.error).toBeDefined()
    expect(errorResponse.error?.code).toBeDefined()

    ws.close()
  })

  it('should return unique subscription IDs for each subscription', async () => {
    const response = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    expect(response.status).toBe(101)
    const ws = response.webSocket!
    ws.accept()

    // Create first subscription
    const sub1 = createSubscribeRequest({ level: 'info' })
    ws.send(JSON.stringify(sub1))
    const ack1 = await waitForMessage(ws, isJSONRPCResponse, 3000)

    // Create second subscription
    const sub2 = createSubscribeRequest({ level: 'error' })
    ws.send(JSON.stringify(sub2))
    const ack2 = await waitForMessage(ws, isJSONRPCResponse, 3000)

    expect(ack1.result?.subscriptionId).toBeDefined()
    expect(ack2.result?.subscriptionId).toBeDefined()
    expect(ack1.result?.subscriptionId).not.toBe(ack2.result?.subscriptionId)

    ws.close()
  })
})

// ============================================================================
// 2. Real-time Event Filtering Tests
// ============================================================================

describeWithWorkers('obs.subscribe - Event Filtering', () => {
  it('should receive events matching the filter', async () => {
    const response = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    expect(response.status).toBe(101)
    const ws = response.webSocket!
    ws.accept()

    // Subscribe to error-level events only
    const filter: ObsFilter = { level: 'error' }
    ws.send(JSON.stringify(createSubscribeRequest(filter)))

    const ack = await waitForMessage(ws, isJSONRPCResponse, 3000)
    expect(ack.result?.subscriptionId).toBeDefined()

    // Now we should receive error events but not info events
    // The broadcaster should only forward matching events
    const eventsPromise = waitForMessage(ws, isEventsMessage, 5000)

    // Trigger an event broadcast (this would be done by the Tail Worker in production)
    // For testing, we simulate by calling the broadcaster directly
    const broadcasterStub = env.OBS_BROADCASTER.get(
      env.OBS_BROADCASTER.idFromName('global')
    )
    await broadcasterStub.fetch('http://broadcaster/broadcast', {
      method: 'POST',
      body: JSON.stringify([
        createObsEvent({ level: 'error', message: ['Error event'] }),
        createObsEvent({ level: 'info', message: ['Info event'] }),
      ]),
    })

    const events = await eventsPromise
    expect(events.data).toBeDefined()
    expect(events.data.every((e) => e.level === 'error')).toBe(true)

    ws.close()
  })

  it('should filter events by type', async () => {
    const response = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    const ws = response.webSocket!
    ws.accept()

    // Subscribe to exception events only
    const filter: ObsFilter = { type: 'exception' }
    ws.send(JSON.stringify(createSubscribeRequest(filter)))

    const ack = await waitForMessage(ws, isJSONRPCResponse, 3000)
    expect(ack.result?.subscriptionId).toBeDefined()

    const eventsPromise = waitForMessage(ws, isEventsMessage, 5000)

    const broadcasterStub = env.OBS_BROADCASTER.get(
      env.OBS_BROADCASTER.idFromName('global')
    )
    await broadcasterStub.fetch('http://broadcaster/broadcast', {
      method: 'POST',
      body: JSON.stringify([
        createObsEvent({ type: 'exception', message: ['Exception!'] }),
        createObsEvent({ type: 'log', message: ['Log message'] }),
      ]),
    })

    const events = await eventsPromise
    expect(events.data.every((e) => e.type === 'exception')).toBe(true)

    ws.close()
  })

  it('should filter events by script name', async () => {
    const response = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    const ws = response.webSocket!
    ws.accept()

    const filter: ObsFilter = { script: 'my-worker' }
    ws.send(JSON.stringify(createSubscribeRequest(filter)))

    const ack = await waitForMessage(ws, isJSONRPCResponse, 3000)
    expect(ack.result?.subscriptionId).toBeDefined()

    const eventsPromise = waitForMessage(ws, isEventsMessage, 5000)

    const broadcasterStub = env.OBS_BROADCASTER.get(
      env.OBS_BROADCASTER.idFromName('global')
    )
    await broadcasterStub.fetch('http://broadcaster/broadcast', {
      method: 'POST',
      body: JSON.stringify([
        createObsEvent({ script: 'my-worker', message: ['From my-worker'] }),
        createObsEvent({ script: 'other-worker', message: ['From other'] }),
      ]),
    })

    const events = await eventsPromise
    expect(events.data.every((e) => e.script === 'my-worker')).toBe(true)

    ws.close()
  })

  it('should receive all events with empty filter', async () => {
    const response = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    const ws = response.webSocket!
    ws.accept()

    // Empty filter should match all events
    ws.send(JSON.stringify(createSubscribeRequest({})))

    const ack = await waitForMessage(ws, isJSONRPCResponse, 3000)
    expect(ack.result?.subscriptionId).toBeDefined()

    const eventsPromise = waitForMessage(ws, isEventsMessage, 5000)

    const broadcasterStub = env.OBS_BROADCASTER.get(
      env.OBS_BROADCASTER.idFromName('global')
    )
    await broadcasterStub.fetch('http://broadcaster/broadcast', {
      method: 'POST',
      body: JSON.stringify([
        createObsEvent({ level: 'info' }),
        createObsEvent({ level: 'error' }),
        createObsEvent({ level: 'warn' }),
      ]),
    })

    const events = await eventsPromise
    expect(events.data.length).toBe(3)

    ws.close()
  })

  it('should filter events by requestId', async () => {
    const response = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    const ws = response.webSocket!
    ws.accept()

    const targetRequestId = 'req-12345'
    const filter: ObsFilter = { requestId: targetRequestId }
    ws.send(JSON.stringify(createSubscribeRequest(filter)))

    const ack = await waitForMessage(ws, isJSONRPCResponse, 3000)
    expect(ack.result?.subscriptionId).toBeDefined()

    const eventsPromise = waitForMessage(ws, isEventsMessage, 5000)

    const broadcasterStub = env.OBS_BROADCASTER.get(
      env.OBS_BROADCASTER.idFromName('global')
    )
    await broadcasterStub.fetch('http://broadcaster/broadcast', {
      method: 'POST',
      body: JSON.stringify([
        createObsEvent({ requestId: targetRequestId }),
        createObsEvent({ requestId: 'other-request' }),
      ]),
    })

    const events = await eventsPromise
    expect(events.data.every((e) => e.requestId === targetRequestId)).toBe(true)

    ws.close()
  })
})

// ============================================================================
// 3. obs.unsubscribe Tests
// ============================================================================

describeWithWorkers('obs.unsubscribe - Closing Subscriptions', () => {
  it('should stop receiving events after unsubscribe', async () => {
    const response = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    const ws = response.webSocket!
    ws.accept()

    // Subscribe first
    ws.send(JSON.stringify(createSubscribeRequest({})))
    const ack = await waitForMessage(ws, isJSONRPCResponse, 3000)
    const subscriptionId = ack.result?.subscriptionId!

    // Unsubscribe
    ws.send(JSON.stringify(createUnsubscribeRequest(subscriptionId)))
    const unsubAck = await waitForMessage(ws, isJSONRPCResponse, 3000)

    expect(unsubAck.result).toBeDefined()
    expect(unsubAck.error).toBeUndefined()

    // After unsubscribe, events should not be delivered
    const messagesReceived: unknown[] = []
    ws.addEventListener('message', (e) => {
      try {
        messagesReceived.push(JSON.parse(e.data as string))
      } catch {
        // Ignore
      }
    })

    // Broadcast events
    const broadcasterStub = env.OBS_BROADCASTER.get(
      env.OBS_BROADCASTER.idFromName('global')
    )
    await broadcasterStub.fetch('http://broadcaster/broadcast', {
      method: 'POST',
      body: JSON.stringify([createObsEvent()]),
    })

    // Wait a bit to see if any events arrive
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Should not have received any events messages
    const eventMessages = messagesReceived.filter(isEventsMessage)
    expect(eventMessages.length).toBe(0)

    ws.close()
  })

  it('should return error for invalid subscription ID', async () => {
    const response = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    const ws = response.webSocket!
    ws.accept()

    // Try to unsubscribe with invalid ID
    ws.send(JSON.stringify(createUnsubscribeRequest('non-existent-id')))
    const errorResponse = await waitForMessage(ws, isJSONRPCResponse, 3000)

    expect(errorResponse.error).toBeDefined()
    expect(errorResponse.error?.code).toBeDefined()

    ws.close()
  })

  it('should handle double unsubscribe gracefully', async () => {
    const response = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    const ws = response.webSocket!
    ws.accept()

    // Subscribe
    ws.send(JSON.stringify(createSubscribeRequest({})))
    const ack = await waitForMessage(ws, isJSONRPCResponse, 3000)
    const subscriptionId = ack.result?.subscriptionId!

    // First unsubscribe
    ws.send(JSON.stringify(createUnsubscribeRequest(subscriptionId)))
    await waitForMessage(ws, isJSONRPCResponse, 3000)

    // Second unsubscribe (should not throw, may return error)
    ws.send(JSON.stringify(createUnsubscribeRequest(subscriptionId)))
    const secondResponse = await waitForMessage(ws, isJSONRPCResponse, 3000)

    // Should either succeed (idempotent) or return a specific error
    expect(secondResponse.id).toBeDefined()

    ws.close()
  })
})

// ============================================================================
// 4. obs.updateFilter Tests
// ============================================================================

describeWithWorkers('obs.updateFilter - Dynamic Filter Updates', () => {
  it('should update filter for existing subscription', async () => {
    const response = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    const ws = response.webSocket!
    ws.accept()

    // Subscribe with initial filter
    const initialFilter: ObsFilter = { level: 'info' }
    ws.send(JSON.stringify(createSubscribeRequest(initialFilter)))
    const ack = await waitForMessage(ws, isJSONRPCResponse, 3000)
    const subscriptionId = ack.result?.subscriptionId!

    // Update filter
    const newFilter: ObsFilter = { level: 'error' }
    ws.send(JSON.stringify(createUpdateFilterRequest(subscriptionId, newFilter)))
    const updateAck = await waitForMessage(ws, isJSONRPCResponse, 3000)

    expect(updateAck.result).toBeDefined()
    expect(updateAck.error).toBeUndefined()

    ws.close()
  })

  it('should only receive events matching updated filter', async () => {
    const response = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    const ws = response.webSocket!
    ws.accept()

    // Subscribe to info events
    ws.send(JSON.stringify(createSubscribeRequest({ level: 'info' })))
    const ack = await waitForMessage(ws, isJSONRPCResponse, 3000)
    const subscriptionId = ack.result?.subscriptionId!

    // Update to error events
    ws.send(
      JSON.stringify(createUpdateFilterRequest(subscriptionId, { level: 'error' }))
    )
    await waitForMessage(ws, isJSONRPCResponse, 3000)

    // Now broadcast both info and error events
    const eventsPromise = waitForMessage(ws, isEventsMessage, 5000)

    const broadcasterStub = env.OBS_BROADCASTER.get(
      env.OBS_BROADCASTER.idFromName('global')
    )
    await broadcasterStub.fetch('http://broadcaster/broadcast', {
      method: 'POST',
      body: JSON.stringify([
        createObsEvent({ level: 'info', message: ['Info'] }),
        createObsEvent({ level: 'error', message: ['Error'] }),
      ]),
    })

    const events = await eventsPromise
    // Should only receive error events after filter update
    expect(events.data.every((e) => e.level === 'error')).toBe(true)

    ws.close()
  })

  it('should return error for updating non-existent subscription', async () => {
    const response = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    const ws = response.webSocket!
    ws.accept()

    // Try to update non-existent subscription
    ws.send(
      JSON.stringify(
        createUpdateFilterRequest('non-existent-id', { level: 'error' })
      )
    )
    const errorResponse = await waitForMessage(ws, isJSONRPCResponse, 3000)

    expect(errorResponse.error).toBeDefined()
    expect(errorResponse.error?.code).toBeDefined()

    ws.close()
  })
})

// ============================================================================
// 5. Multiple Subscribers Tests
// ============================================================================

describeWithWorkers('obs.subscribe - Multiple Subscribers', () => {
  it('should deliver same events to multiple subscribers with matching filters', async () => {
    // Create two WebSocket connections
    const response1 = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })
    const response2 = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    const ws1 = response1.webSocket!
    const ws2 = response2.webSocket!
    ws1.accept()
    ws2.accept()

    // Both subscribe to all events
    ws1.send(JSON.stringify(createSubscribeRequest({})))
    ws2.send(JSON.stringify(createSubscribeRequest({})))

    await waitForMessage(ws1, isJSONRPCResponse, 3000)
    await waitForMessage(ws2, isJSONRPCResponse, 3000)

    // Set up listeners for events
    const ws1Events: ObsEventMessage[] = []
    const ws2Events: ObsEventMessage[] = []

    ws1.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data as string)
      if (isEventsMessage(msg)) ws1Events.push(msg)
    })
    ws2.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data as string)
      if (isEventsMessage(msg)) ws2Events.push(msg)
    })

    // Broadcast events
    const broadcasterStub = env.OBS_BROADCASTER.get(
      env.OBS_BROADCASTER.idFromName('global')
    )
    const testEvent = createObsEvent({ message: ['Shared event'] })
    await broadcasterStub.fetch('http://broadcaster/broadcast', {
      method: 'POST',
      body: JSON.stringify([testEvent]),
    })

    // Wait for events to be delivered
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Both should have received the event
    expect(ws1Events.length).toBeGreaterThan(0)
    expect(ws2Events.length).toBeGreaterThan(0)
    expect(ws1Events[0].data[0].id).toBe(testEvent.id)
    expect(ws2Events[0].data[0].id).toBe(testEvent.id)

    ws1.close()
    ws2.close()
  })

  it('should deliver different events based on different filters', async () => {
    const response1 = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })
    const response2 = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    const ws1 = response1.webSocket!
    const ws2 = response2.webSocket!
    ws1.accept()
    ws2.accept()

    // WS1 subscribes to info events
    ws1.send(JSON.stringify(createSubscribeRequest({ level: 'info' })))
    // WS2 subscribes to error events
    ws2.send(JSON.stringify(createSubscribeRequest({ level: 'error' })))

    await waitForMessage(ws1, isJSONRPCResponse, 3000)
    await waitForMessage(ws2, isJSONRPCResponse, 3000)

    const ws1Events: ObsEventMessage[] = []
    const ws2Events: ObsEventMessage[] = []

    ws1.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data as string)
      if (isEventsMessage(msg)) ws1Events.push(msg)
    })
    ws2.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data as string)
      if (isEventsMessage(msg)) ws2Events.push(msg)
    })

    // Broadcast both info and error events
    const broadcasterStub = env.OBS_BROADCASTER.get(
      env.OBS_BROADCASTER.idFromName('global')
    )
    await broadcasterStub.fetch('http://broadcaster/broadcast', {
      method: 'POST',
      body: JSON.stringify([
        createObsEvent({ level: 'info', message: ['Info event'] }),
        createObsEvent({ level: 'error', message: ['Error event'] }),
      ]),
    })

    await new Promise((resolve) => setTimeout(resolve, 1000))

    // WS1 should only have info events
    expect(ws1Events.length).toBeGreaterThan(0)
    expect(ws1Events[0].data.every((e) => e.level === 'info')).toBe(true)

    // WS2 should only have error events
    expect(ws2Events.length).toBeGreaterThan(0)
    expect(ws2Events[0].data.every((e) => e.level === 'error')).toBe(true)

    ws1.close()
    ws2.close()
  })

  it('should handle subscriber disconnect without affecting others', async () => {
    const response1 = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })
    const response2 = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    const ws1 = response1.webSocket!
    const ws2 = response2.webSocket!
    ws1.accept()
    ws2.accept()

    // Both subscribe
    ws1.send(JSON.stringify(createSubscribeRequest({})))
    ws2.send(JSON.stringify(createSubscribeRequest({})))

    await waitForMessage(ws1, isJSONRPCResponse, 3000)
    await waitForMessage(ws2, isJSONRPCResponse, 3000)

    // Disconnect WS1
    ws1.close()

    // WS2 should still receive events
    const eventsPromise = waitForMessage(ws2, isEventsMessage, 5000)

    const broadcasterStub = env.OBS_BROADCASTER.get(
      env.OBS_BROADCASTER.idFromName('global')
    )
    await broadcasterStub.fetch('http://broadcaster/broadcast', {
      method: 'POST',
      body: JSON.stringify([createObsEvent()]),
    })

    const events = await eventsPromise
    expect(events.data.length).toBeGreaterThan(0)

    ws2.close()
  })
})

// ============================================================================
// 6. Reconnection Handling Tests
// ============================================================================

describeWithWorkers('obs.subscribe - Reconnection Handling', () => {
  it('should allow re-subscribing after disconnect', async () => {
    // First connection
    const response1 = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    const ws1 = response1.webSocket!
    ws1.accept()

    ws1.send(JSON.stringify(createSubscribeRequest({})))
    const ack1 = await waitForMessage(ws1, isJSONRPCResponse, 3000)
    const subscriptionId1 = ack1.result?.subscriptionId

    // Disconnect
    ws1.close()

    // Reconnect
    const response2 = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    const ws2 = response2.webSocket!
    ws2.accept()

    ws2.send(JSON.stringify(createSubscribeRequest({})))
    const ack2 = await waitForMessage(ws2, isJSONRPCResponse, 3000)
    const subscriptionId2 = ack2.result?.subscriptionId

    // Should get a new subscription ID
    expect(subscriptionId2).toBeDefined()
    expect(subscriptionId2).not.toBe(subscriptionId1)

    ws2.close()
  })

  it('should not receive events from before reconnection', async () => {
    // Connect and subscribe
    const response1 = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    const ws1 = response1.webSocket!
    ws1.accept()

    ws1.send(JSON.stringify(createSubscribeRequest({})))
    await waitForMessage(ws1, isJSONRPCResponse, 3000)

    // Disconnect
    ws1.close()

    // Broadcast event while disconnected
    const broadcasterStub = env.OBS_BROADCASTER.get(
      env.OBS_BROADCASTER.idFromName('global')
    )
    const missedEvent = createObsEvent({ message: ['Missed event'] })
    await broadcasterStub.fetch('http://broadcaster/broadcast', {
      method: 'POST',
      body: JSON.stringify([missedEvent]),
    })

    // Reconnect
    const response2 = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    const ws2 = response2.webSocket!
    ws2.accept()

    ws2.send(JSON.stringify(createSubscribeRequest({})))
    await waitForMessage(ws2, isJSONRPCResponse, 3000)

    // Collect received events
    const receivedEvents: ObsEventMessage[] = []
    ws2.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data as string)
      if (isEventsMessage(msg)) receivedEvents.push(msg)
    })

    // Broadcast new event
    const newEvent = createObsEvent({ message: ['New event'] })
    await broadcasterStub.fetch('http://broadcaster/broadcast', {
      method: 'POST',
      body: JSON.stringify([newEvent]),
    })

    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Should have received the new event but not the missed one
    expect(receivedEvents.length).toBeGreaterThan(0)
    const allEventIds = receivedEvents.flatMap((e) => e.data.map((d) => d.id))
    expect(allEventIds).toContain(newEvent.id)
    expect(allEventIds).not.toContain(missedEvent.id)

    ws2.close()
  })

  it('should restore same filter on re-subscribe', async () => {
    const filter: ObsFilter = { level: 'error', script: 'api' }

    // First connection with filter
    const response1 = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    const ws1 = response1.webSocket!
    ws1.accept()

    ws1.send(JSON.stringify(createSubscribeRequest(filter)))
    const ack1 = await waitForMessage(ws1, isJSONRPCResponse, 3000)
    expect(ack1.result?.filter).toEqual(filter)

    ws1.close()

    // Reconnect with same filter
    const response2 = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    const ws2 = response2.webSocket!
    ws2.accept()

    ws2.send(JSON.stringify(createSubscribeRequest(filter)))
    const ack2 = await waitForMessage(ws2, isJSONRPCResponse, 3000)
    expect(ack2.result?.filter).toEqual(filter)

    // Verify filter is working
    const eventsPromise = waitForMessage(ws2, isEventsMessage, 5000)

    const broadcasterStub = env.OBS_BROADCASTER.get(
      env.OBS_BROADCASTER.idFromName('global')
    )
    await broadcasterStub.fetch('http://broadcaster/broadcast', {
      method: 'POST',
      body: JSON.stringify([
        createObsEvent({ level: 'error', script: 'api' }),
        createObsEvent({ level: 'info', script: 'api' }),
      ]),
    })

    const events = await eventsPromise
    expect(events.data.every((e) => e.level === 'error' && e.script === 'api')).toBe(
      true
    )

    ws2.close()
  })
})

// ============================================================================
// 7. Error Handling and Edge Cases
// ============================================================================

describeWithWorkers('obs.subscribe - Error Handling', () => {
  it('should handle malformed JSON gracefully', async () => {
    const response = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    const ws = response.webSocket!
    ws.accept()

    // Send malformed JSON
    ws.send('not valid json {')

    const errorResponse = await waitForMessage(ws, isJSONRPCResponse, 3000)
    expect(errorResponse.error).toBeDefined()
    expect(errorResponse.error?.code).toBe(-32700) // Parse error

    ws.close()
  })

  it('should handle missing method gracefully', async () => {
    const response = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    const ws = response.webSocket!
    ws.accept()

    // Send request without method
    ws.send(
      JSON.stringify({
        jsonrpc: '2.0',
        params: {},
        id: 'test',
      })
    )

    const errorResponse = await waitForMessage(ws, isJSONRPCResponse, 3000)
    expect(errorResponse.error).toBeDefined()

    ws.close()
  })

  it('should handle unknown RPC method', async () => {
    const response = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    const ws = response.webSocket!
    ws.accept()

    ws.send(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'obs.unknownMethod',
        params: {},
        id: 'test',
      })
    )

    const errorResponse = await waitForMessage(ws, isJSONRPCResponse, 3000)
    expect(errorResponse.error).toBeDefined()
    expect(errorResponse.error?.code).toBe(-32601) // Method not found

    ws.close()
  })

  it('should handle very large filter gracefully', async () => {
    const response = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    const ws = response.webSocket!
    ws.accept()

    // Create a filter that's too complex (not necessarily large in size)
    // This tests validation of filter structure
    const invalidFilter = {
      level: 'error',
      script: 'test',
      // Add extra invalid fields
      extraField1: 'invalid',
      extraField2: 'also invalid',
    } as unknown as ObsFilter

    ws.send(JSON.stringify(createSubscribeRequest(invalidFilter)))

    const errorResponse = await waitForMessage(ws, isJSONRPCResponse, 3000)
    // Should either accept (ignoring extra fields) or reject with validation error
    expect(errorResponse.id).toBeDefined()

    ws.close()
  })
})

// ============================================================================
// 8. HTTP Fallback Tests (for obs.subscribe via POST)
// ============================================================================

describeWithWorkers('obs.subscribe - HTTP POST (non-WebSocket)', () => {
  it('should return appropriate error when called via HTTP POST', async () => {
    // Try to call obs.subscribe via HTTP POST instead of WebSocket
    const response = await SELF.fetch('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'obs.subscribe',
        params: { filter: {} },
        id: 'http-test',
      }),
    })

    const body = await response.json()

    // obs.subscribe requires WebSocket, should return error for HTTP
    expect(body.error).toBeDefined()
    expect(body.error.message).toContain('WebSocket')
  })
})
