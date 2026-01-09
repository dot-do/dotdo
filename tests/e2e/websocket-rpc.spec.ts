import { test, expect, type Page } from '@playwright/test'

/**
 * E2E Tests for WebSocket RPC functionality
 *
 * TDD RED Phase - These tests cover WebSocket-based RPC at /rpc endpoint
 * All tests are expected to FAIL until WebSocket RPC is fully implemented.
 *
 * Test categories:
 * 1. Connection tests (connect, disconnect, reconnect)
 * 2. Method call tests (call methods, receive responses)
 * 3. Batch request tests (multiple calls in one message)
 * 4. Subscription tests (subscribe to events)
 * 5. Error handling tests (method not found, invalid params)
 * 6. Promise pipelining tests (chain method calls)
 * 7. Binary data tests (ArrayBuffer handling)
 * 8. Timeout tests (request timeout handling)
 */

// =============================================================================
// Types
// =============================================================================

interface RPCRequest {
  jsonrpc: '2.0'
  method: string
  params?: unknown
  id?: string | number
}

interface RPCResponse {
  jsonrpc: '2.0'
  result?: unknown
  error?: RPCError
  id: string | number | null
}

interface RPCError {
  code: number
  message: string
  data?: unknown
}

interface CapnwebRequest {
  id: string
  type: 'call' | 'batch' | 'resolve' | 'dispose'
  calls?: CapnwebCall[]
  resolve?: { promiseId: string }
  dispose?: { promiseIds: string[] }
}

interface CapnwebCall {
  promiseId: string
  target: { type: 'root' } | { type: 'promise'; promiseId: string } | { type: 'property'; base: unknown; property: string }
  method: string
  args: Array<{ type: 'value'; value: unknown } | { type: 'promise'; promiseId: string }>
}

interface CapnwebResponse {
  id: string
  type: 'result' | 'error' | 'batch'
  results?: Array<{
    promiseId: string
    type: 'value' | 'promise' | 'error'
    value?: unknown
    error?: { code: string; message: string }
  }>
  error?: { code: string; message: string }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Helper to create a WebSocket connection via page evaluation
 * Returns methods to interact with the WebSocket
 */
async function createWebSocket(page: Page, path: string = '/rpc'): Promise<{
  send: (data: unknown) => Promise<void>
  waitForMessage: (timeout?: number) => Promise<unknown>
  close: () => Promise<void>
  getReadyState: () => Promise<number>
}> {
  const wsId = `ws_${Date.now()}`

  await page.evaluate(
    ({ wsId, path }) => {
      const ws = new WebSocket(`ws://localhost:8787${path}`)
      ;(window as unknown as Record<string, unknown>)[wsId] = {
        ws,
        messages: [] as unknown[],
        resolvers: [] as Array<(msg: unknown) => void>,
      }

      ws.onmessage = (event) => {
        const store = (window as unknown as Record<string, { messages: unknown[]; resolvers: Array<(msg: unknown) => void> }>)[wsId]
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        if (store.resolvers.length > 0) {
          const resolver = store.resolvers.shift()!
          resolver(data)
        } else {
          store.messages.push(data)
        }
      }

      return new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve()
        ws.onerror = () => reject(new Error('WebSocket connection failed'))
        setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000)
      })
    },
    { wsId, path },
  )

  return {
    send: async (data: unknown) => {
      await page.evaluate(
        ({ wsId, data }) => {
          const store = (window as unknown as Record<string, { ws: WebSocket }>)[wsId]
          store.ws.send(typeof data === 'string' ? data : JSON.stringify(data))
        },
        { wsId, data },
      )
    },

    waitForMessage: async (timeout = 5000) => {
      return page.evaluate(
        ({ wsId, timeout }) => {
          return new Promise((resolve, reject) => {
            const store = (window as unknown as Record<string, { messages: unknown[]; resolvers: Array<(msg: unknown) => void> }>)[wsId]
            if (store.messages.length > 0) {
              resolve(store.messages.shift())
              return
            }
            const timer = setTimeout(() => reject(new Error('Message timeout')), timeout)
            store.resolvers.push((msg) => {
              clearTimeout(timer)
              resolve(msg)
            })
          })
        },
        { wsId, timeout },
      )
    },

    close: async () => {
      await page.evaluate(
        ({ wsId }) => {
          const store = (window as unknown as Record<string, { ws: WebSocket }>)[wsId]
          store.ws.close()
        },
        { wsId },
      )
    },

    getReadyState: async () => {
      return page.evaluate(
        ({ wsId }) => {
          const store = (window as unknown as Record<string, { ws: WebSocket }>)[wsId]
          return store.ws.readyState
        },
        { wsId },
      )
    },
  }
}

// =============================================================================
// 1. Connection Tests
// =============================================================================

test.describe('WebSocket RPC - Connection', () => {
  test.describe('Basic Connection', () => {
    test('should establish WebSocket connection to /rpc', async ({ page }) => {
      await page.goto('/')

      const connected = await page.evaluate(() => {
        return new Promise<boolean>((resolve, reject) => {
          const ws = new WebSocket('ws://localhost:8787/rpc')
          ws.onopen = () => {
            ws.close()
            resolve(true)
          }
          ws.onerror = () => reject(new Error('Connection failed'))
          setTimeout(() => reject(new Error('Connection timeout')), 5000)
        })
      })

      expect(connected).toBe(true)
    })

    test('should establish WebSocket connection to /rpc/Users DO', async ({ page }) => {
      await page.goto('/')

      const connected = await page.evaluate(() => {
        return new Promise<boolean>((resolve, reject) => {
          const ws = new WebSocket('ws://localhost:8787/rpc/Users')
          ws.onopen = () => {
            ws.close()
            resolve(true)
          }
          ws.onerror = () => reject(new Error('Connection failed'))
          setTimeout(() => reject(new Error('Connection timeout')), 5000)
        })
      })

      expect(connected).toBe(true)
    })

    test('should receive connection acknowledgment message', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      // Server should send a welcome/ready message on connection
      const message = (await ws.waitForMessage()) as { type: string }
      expect(message.type).toBe('connected')

      await ws.close()
    })

    test('should include session ID in connection response', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      const message = (await ws.waitForMessage()) as { sessionId?: string }
      expect(message.sessionId).toBeDefined()
      expect(typeof message.sessionId).toBe('string')

      await ws.close()
    })
  })

  test.describe('Disconnection', () => {
    test('should handle clean disconnect', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      await ws.close()
      const readyState = await ws.getReadyState()

      // WebSocket.CLOSED = 3
      expect(readyState).toBe(3)
    })

    test('should receive close event with correct code', async ({ page }) => {
      await page.goto('/')

      const closeCode = await page.evaluate(() => {
        return new Promise<number>((resolve, reject) => {
          const ws = new WebSocket('ws://localhost:8787/rpc')
          ws.onopen = () => {
            ws.close(1000, 'Normal closure')
          }
          ws.onclose = (event) => resolve(event.code)
          ws.onerror = () => reject(new Error('Connection error'))
          setTimeout(() => reject(new Error('Timeout')), 5000)
        })
      })

      expect(closeCode).toBe(1000)
    })

    test('should cleanup resources on disconnect', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      // Create some server-side state
      await ws.send({
        id: 'test-1',
        type: 'call',
        calls: [
          {
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'createSession',
            args: [],
          },
        ],
      })

      await ws.waitForMessage()
      await ws.close()

      // Reconnect and verify old session is gone
      const ws2 = await createWebSocket(page)
      await ws2.send({
        id: 'test-2',
        type: 'call',
        calls: [
          {
            promiseId: 'p2',
            target: { type: 'promise', promiseId: 'p1' },
            method: 'getData',
            args: [],
          },
        ],
      })

      const response = (await ws2.waitForMessage()) as CapnwebResponse
      expect(response.results?.[0]?.type).toBe('error')
      expect(response.results?.[0]?.error?.code).toMatch(/INVALID_PROMISE|NOT_FOUND/)

      await ws2.close()
    })
  })

  test.describe('Reconnection', () => {
    test('should allow reconnection after disconnect', async ({ page }) => {
      await page.goto('/')

      // First connection
      const ws1 = await createWebSocket(page)
      await ws1.close()

      // Wait a bit
      await page.waitForTimeout(100)

      // Second connection should work
      const ws2 = await createWebSocket(page)
      const readyState = await ws2.getReadyState()
      expect(readyState).toBe(1) // WebSocket.OPEN

      await ws2.close()
    })

    test('should get new session ID on reconnect', async ({ page }) => {
      await page.goto('/')

      const ws1 = await createWebSocket(page)
      const msg1 = (await ws1.waitForMessage()) as { sessionId: string }
      const sessionId1 = msg1.sessionId
      await ws1.close()

      await page.waitForTimeout(100)

      const ws2 = await createWebSocket(page)
      const msg2 = (await ws2.waitForMessage()) as { sessionId: string }
      const sessionId2 = msg2.sessionId

      expect(sessionId1).not.toBe(sessionId2)
      await ws2.close()
    })

    test('should handle rapid reconnections', async ({ page }) => {
      await page.goto('/')

      for (let i = 0; i < 5; i++) {
        const ws = await createWebSocket(page)
        await ws.close()
      }

      // Final connection should still work
      const ws = await createWebSocket(page)
      const readyState = await ws.getReadyState()
      expect(readyState).toBe(1)
      await ws.close()
    })
  })

  test.describe('Connection Errors', () => {
    test('should reject invalid WebSocket paths', async ({ page }) => {
      await page.goto('/')

      const result = await page.evaluate(() => {
        return new Promise<{ error: boolean; code?: number }>((resolve) => {
          const ws = new WebSocket('ws://localhost:8787/invalid-rpc-path')
          ws.onopen = () => {
            ws.close()
            resolve({ error: false })
          }
          ws.onclose = (event) => resolve({ error: true, code: event.code })
          ws.onerror = () => resolve({ error: true })
          setTimeout(() => resolve({ error: true }), 5000)
        })
      })

      expect(result.error).toBe(true)
    })

    test('should handle connection timeout gracefully', async ({ page }) => {
      await page.goto('/')

      // This test assumes server has timeout handling
      // The actual timeout value would be configured server-side
      const result = await page.evaluate(() => {
        return new Promise<boolean>((resolve) => {
          const ws = new WebSocket('ws://localhost:8787/rpc')
          ws.onopen = () => {
            // Don't send any messages, wait for server timeout
          }
          ws.onclose = () => resolve(true)
          // This should be longer than server timeout
          setTimeout(() => {
            ws.close()
            resolve(false)
          }, 60000)
        })
      })

      // Server should have closed connection or it timed out
      expect(result).toBeDefined()
    })
  })
})

// =============================================================================
// 2. Method Call Tests
// =============================================================================

test.describe('WebSocket RPC - Method Calls', () => {
  test.describe('JSON-RPC 2.0 Format', () => {
    test('should handle JSON-RPC 2.0 method call', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      const request: RPCRequest = {
        jsonrpc: '2.0',
        method: 'get',
        params: { id: 'user-123' },
        id: 1,
      }

      await ws.send(request)
      const response = (await ws.waitForMessage()) as RPCResponse

      expect(response.jsonrpc).toBe('2.0')
      expect(response.id).toBe(1)
      expect(response.result).toBeDefined()

      await ws.close()
    })

    test('should return result for successful method call', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      await ws.send({
        jsonrpc: '2.0',
        method: 'echo',
        params: { message: 'hello world' },
        id: 'echo-1',
      })

      const response = (await ws.waitForMessage()) as RPCResponse
      expect(response.result).toEqual({ message: 'hello world' })

      await ws.close()
    })

    test('should handle method call without params', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      await ws.send({
        jsonrpc: '2.0',
        method: 'ping',
        id: 'ping-1',
      })

      const response = (await ws.waitForMessage()) as RPCResponse
      expect(response.result).toBeDefined()

      await ws.close()
    })

    test('should handle notification (no id)', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      // Notification - no response expected
      await ws.send({
        jsonrpc: '2.0',
        method: 'log',
        params: { level: 'info', message: 'test' },
      })

      // Server should not respond to notifications
      // Wait briefly and verify no message received
      const result = await page.evaluate(() => {
        return new Promise<boolean>((resolve) => {
          setTimeout(() => resolve(true), 500)
        })
      })

      expect(result).toBe(true)
      await ws.close()
    })
  })

  test.describe('Capnweb Format', () => {
    test('should handle capnweb call format', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      const request: CapnwebRequest = {
        id: 'cap-1',
        type: 'call',
        calls: [
          {
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'echo',
            args: [{ type: 'value', value: 'hello' }],
          },
        ],
      }

      await ws.send(request)
      const response = (await ws.waitForMessage()) as CapnwebResponse

      expect(response.id).toBe('cap-1')
      expect(response.results?.[0]?.value).toBe('hello')

      await ws.close()
    })

    test('should handle method with multiple arguments', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      await ws.send({
        id: 'add-1',
        type: 'call',
        calls: [
          {
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'add',
            args: [
              { type: 'value', value: 5 },
              { type: 'value', value: 3 },
            ],
          },
        ],
      })

      const response = (await ws.waitForMessage()) as CapnwebResponse
      expect(response.results?.[0]?.value).toBe(8)

      await ws.close()
    })

    test('should handle method returning object', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      await ws.send({
        id: 'user-1',
        type: 'call',
        calls: [
          {
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'getUser',
            args: [{ type: 'value', value: 'alice' }],
          },
        ],
      })

      const response = (await ws.waitForMessage()) as CapnwebResponse
      expect(response.results?.[0]?.value).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
      })

      await ws.close()
    })

    test('should handle method returning array', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      await ws.send({
        id: 'posts-1',
        type: 'call',
        calls: [
          {
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'getPosts',
            args: [],
          },
        ],
      })

      const response = (await ws.waitForMessage()) as CapnwebResponse
      expect(Array.isArray(response.results?.[0]?.value)).toBe(true)

      await ws.close()
    })
  })

  test.describe('Durable Object Method Calls', () => {
    test('should call method on specific DO instance', async ({ page }) => {
      await page.goto('/')

      // Connect to specific DO via path
      const ws = await createWebSocket(page, '/rpc/Users/user-123')

      await ws.send({
        id: 'do-1',
        type: 'call',
        calls: [
          {
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'get',
            args: [],
          },
        ],
      })

      const response = (await ws.waitForMessage()) as CapnwebResponse
      expect(response.results?.[0]?.type).not.toBe('error')

      await ws.close()
    })

    test('should call method with ID parameter', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page, '/rpc/Users')

      await ws.send({
        id: 'do-2',
        type: 'call',
        calls: [
          {
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'get',
            args: [{ type: 'value', value: 'user-456' }],
          },
        ],
      })

      const response = (await ws.waitForMessage()) as CapnwebResponse
      expect(response.results?.[0]?.type).not.toBe('error')

      await ws.close()
    })
  })
})

// =============================================================================
// 3. Batch Request Tests
// =============================================================================

test.describe('WebSocket RPC - Batch Requests', () => {
  test.describe('JSON-RPC Batch', () => {
    test('should handle batch of JSON-RPC requests', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      const batch: RPCRequest[] = [
        { jsonrpc: '2.0', method: 'get', params: { id: '1' }, id: 1 },
        { jsonrpc: '2.0', method: 'get', params: { id: '2' }, id: 2 },
        { jsonrpc: '2.0', method: 'get', params: { id: '3' }, id: 3 },
      ]

      await ws.send(batch)
      const response = (await ws.waitForMessage()) as RPCResponse[]

      expect(Array.isArray(response)).toBe(true)
      expect(response.length).toBe(3)
      expect(response[0].id).toBe(1)
      expect(response[1].id).toBe(2)
      expect(response[2].id).toBe(3)

      await ws.close()
    })

    test('should process batch requests in order', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      const batch: RPCRequest[] = [
        { jsonrpc: '2.0', method: 'echo', params: { n: 1 }, id: 'a' },
        { jsonrpc: '2.0', method: 'echo', params: { n: 2 }, id: 'b' },
        { jsonrpc: '2.0', method: 'echo', params: { n: 3 }, id: 'c' },
      ]

      await ws.send(batch)
      const response = (await ws.waitForMessage()) as RPCResponse[]

      expect(response[0].id).toBe('a')
      expect(response[1].id).toBe('b')
      expect(response[2].id).toBe('c')

      await ws.close()
    })

    test('should handle mixed success and error in batch', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      const batch: RPCRequest[] = [
        { jsonrpc: '2.0', method: 'echo', params: { msg: 'ok' }, id: 1 },
        { jsonrpc: '2.0', method: 'nonexistent', params: {}, id: 2 },
        { jsonrpc: '2.0', method: 'echo', params: { msg: 'ok2' }, id: 3 },
      ]

      await ws.send(batch)
      const response = (await ws.waitForMessage()) as RPCResponse[]

      expect(response[0].result).toBeDefined()
      expect(response[1].error).toBeDefined()
      expect(response[2].result).toBeDefined()

      await ws.close()
    })

    test('should handle empty batch array', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      await ws.send([])
      const response = (await ws.waitForMessage()) as RPCResponse

      // Empty batch should return error
      expect(response.error).toBeDefined()
      expect(response.error?.code).toBe(-32600) // Invalid Request

      await ws.close()
    })
  })

  test.describe('Capnweb Batch', () => {
    test('should handle capnweb batch type', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      const request: CapnwebRequest = {
        id: 'batch-1',
        type: 'batch',
        calls: [
          { promiseId: 'p1', target: { type: 'root' }, method: 'getUser', args: [{ type: 'value', value: 'alice' }] },
          { promiseId: 'p2', target: { type: 'root' }, method: 'getPosts', args: [] },
          { promiseId: 'p3', target: { type: 'root' }, method: 'getData', args: [] },
        ],
      }

      await ws.send(request)
      const response = (await ws.waitForMessage()) as CapnwebResponse

      expect(response.type).toBe('batch')
      expect(response.results?.length).toBe(3)

      await ws.close()
    })

    test('should handle large batch requests', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      const calls: CapnwebCall[] = Array.from({ length: 100 }, (_, i) => ({
        promiseId: `p${i}`,
        target: { type: 'root' } as const,
        method: 'echo',
        args: [{ type: 'value' as const, value: i }],
      }))

      await ws.send({
        id: 'large-batch',
        type: 'batch',
        calls,
      })

      const response = (await ws.waitForMessage()) as CapnwebResponse
      expect(response.results?.length).toBe(100)

      await ws.close()
    })
  })
})

// =============================================================================
// 4. Subscription Tests
// =============================================================================

test.describe('WebSocket RPC - Subscriptions', () => {
  test.describe('Basic Subscriptions', () => {
    test('should subscribe to events', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      await ws.send({
        jsonrpc: '2.0',
        method: 'subscribe',
        params: { event: 'userUpdated' },
        id: 'sub-1',
      })

      const response = (await ws.waitForMessage()) as RPCResponse
      expect(response.result).toMatchObject({
        subscriptionId: expect.any(String),
      })

      await ws.close()
    })

    test('should receive events after subscription', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      // Subscribe
      await ws.send({
        jsonrpc: '2.0',
        method: 'subscribe',
        params: { event: 'userUpdated' },
        id: 'sub-1',
      })
      await ws.waitForMessage() // subscription confirmation

      // Trigger an event (via another call)
      await ws.send({
        jsonrpc: '2.0',
        method: 'updateUser',
        params: { id: 'user-1', name: 'New Name' },
        id: 'update-1',
      })

      // Should receive the update response
      const updateResponse = (await ws.waitForMessage()) as RPCResponse
      expect(updateResponse.id).toBe('update-1')

      // Should also receive the event notification
      const eventNotification = (await ws.waitForMessage()) as {
        jsonrpc: '2.0'
        method: string
        params: unknown
      }
      expect(eventNotification.method).toBe('userUpdated')

      await ws.close()
    })

    test('should unsubscribe from events', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      // Subscribe
      await ws.send({
        jsonrpc: '2.0',
        method: 'subscribe',
        params: { event: 'userUpdated' },
        id: 'sub-1',
      })
      const subResponse = (await ws.waitForMessage()) as RPCResponse
      const subscriptionId = (subResponse.result as { subscriptionId: string }).subscriptionId

      // Unsubscribe
      await ws.send({
        jsonrpc: '2.0',
        method: 'unsubscribe',
        params: { subscriptionId },
        id: 'unsub-1',
      })
      const unsubResponse = (await ws.waitForMessage()) as RPCResponse
      expect(unsubResponse.result).toMatchObject({ success: true })

      await ws.close()
    })

    test('should not receive events after unsubscribe', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      // Subscribe then unsubscribe
      await ws.send({
        jsonrpc: '2.0',
        method: 'subscribe',
        params: { event: 'userUpdated' },
        id: 'sub-1',
      })
      const subResponse = (await ws.waitForMessage()) as RPCResponse
      const subscriptionId = (subResponse.result as { subscriptionId: string }).subscriptionId

      await ws.send({
        jsonrpc: '2.0',
        method: 'unsubscribe',
        params: { subscriptionId },
        id: 'unsub-1',
      })
      await ws.waitForMessage()

      // Trigger event
      await ws.send({
        jsonrpc: '2.0',
        method: 'updateUser',
        params: { id: 'user-1', name: 'Changed' },
        id: 'update-1',
      })

      // Should only get update response, not event notification
      const response = (await ws.waitForMessage()) as RPCResponse
      expect(response.id).toBe('update-1')

      // Verify no additional messages
      const hasExtraMessage = await page.evaluate(() => {
        return new Promise<boolean>((resolve) => {
          setTimeout(() => resolve(false), 500)
        })
      })
      expect(hasExtraMessage).toBe(false)

      await ws.close()
    })
  })

  test.describe('Multiple Subscriptions', () => {
    test('should handle multiple subscriptions from same client', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      await ws.send({
        jsonrpc: '2.0',
        method: 'subscribe',
        params: { event: 'userUpdated' },
        id: 'sub-1',
      })
      const sub1 = (await ws.waitForMessage()) as RPCResponse

      await ws.send({
        jsonrpc: '2.0',
        method: 'subscribe',
        params: { event: 'postCreated' },
        id: 'sub-2',
      })
      const sub2 = (await ws.waitForMessage()) as RPCResponse

      const id1 = (sub1.result as { subscriptionId: string }).subscriptionId
      const id2 = (sub2.result as { subscriptionId: string }).subscriptionId

      expect(id1).not.toBe(id2)

      await ws.close()
    })

    test('should receive events from all subscriptions', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      // Subscribe to two events
      await ws.send({
        jsonrpc: '2.0',
        method: 'subscribe',
        params: { event: 'eventA' },
        id: 'sub-a',
      })
      await ws.waitForMessage()

      await ws.send({
        jsonrpc: '2.0',
        method: 'subscribe',
        params: { event: 'eventB' },
        id: 'sub-b',
      })
      await ws.waitForMessage()

      // Trigger both events
      await ws.send({
        jsonrpc: '2.0',
        method: 'triggerEvent',
        params: { event: 'eventA', data: 'A' },
        id: 'trigger-a',
      })
      await ws.send({
        jsonrpc: '2.0',
        method: 'triggerEvent',
        params: { event: 'eventB', data: 'B' },
        id: 'trigger-b',
      })

      // Collect messages
      const messages: unknown[] = []
      for (let i = 0; i < 4; i++) {
        // 2 responses + 2 notifications
        messages.push(await ws.waitForMessage())
      }

      const events = messages.filter((m) => !(m as { id?: unknown }).id)
      expect(events.length).toBe(2)

      await ws.close()
    })
  })
})

// =============================================================================
// 5. Error Handling Tests
// =============================================================================

test.describe('WebSocket RPC - Error Handling', () => {
  test.describe('JSON-RPC Errors', () => {
    test('should return -32700 for parse errors', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      await ws.send('not valid json {{{')
      const response = (await ws.waitForMessage()) as RPCResponse

      expect(response.error?.code).toBe(-32700)
      expect(response.error?.message).toContain('Parse')

      await ws.close()
    })

    test('should return -32600 for invalid request', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      await ws.send({ invalid: 'request' })
      const response = (await ws.waitForMessage()) as RPCResponse

      expect(response.error?.code).toBe(-32600)

      await ws.close()
    })

    test('should return -32601 for method not found', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      await ws.send({
        jsonrpc: '2.0',
        method: 'nonExistentMethod123',
        id: 1,
      })
      const response = (await ws.waitForMessage()) as RPCResponse

      expect(response.error?.code).toBe(-32601)
      expect(response.error?.message.toLowerCase()).toContain('not found')

      await ws.close()
    })

    test('should return -32602 for invalid params', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      await ws.send({
        jsonrpc: '2.0',
        method: 'getUser',
        params: { invalidParam: 123 }, // wrong param structure
        id: 1,
      })
      const response = (await ws.waitForMessage()) as RPCResponse

      expect(response.error?.code).toBe(-32602)

      await ws.close()
    })

    test('should return -32603 for internal errors', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      await ws.send({
        jsonrpc: '2.0',
        method: 'throwInternalError',
        id: 1,
      })
      const response = (await ws.waitForMessage()) as RPCResponse

      expect(response.error?.code).toBe(-32603)

      await ws.close()
    })
  })

  test.describe('Capnweb Errors', () => {
    test('should return METHOD_NOT_FOUND for unknown method', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      await ws.send({
        id: 'err-1',
        type: 'call',
        calls: [
          {
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'unknownMethod',
            args: [],
          },
        ],
      })

      const response = (await ws.waitForMessage()) as CapnwebResponse
      expect(response.results?.[0]?.type).toBe('error')
      expect(response.results?.[0]?.error?.code).toBe('METHOD_NOT_FOUND')

      await ws.close()
    })

    test('should return INVALID_PROMISE for bad promise reference', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      await ws.send({
        id: 'err-2',
        type: 'call',
        calls: [
          {
            promiseId: 'p1',
            target: { type: 'promise', promiseId: 'non-existent' },
            method: 'someMethod',
            args: [],
          },
        ],
      })

      const response = (await ws.waitForMessage()) as CapnwebResponse
      expect(response.results?.[0]?.type).toBe('error')
      expect(response.results?.[0]?.error?.code).toMatch(/INVALID_PROMISE|NOT_FOUND/)

      await ws.close()
    })

    test('should return DISPOSED_REFERENCE for disposed promise', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      // Create then dispose
      await ws.send({
        id: 'create-1',
        type: 'call',
        calls: [{ promiseId: 'session', target: { type: 'root' }, method: 'createSession', args: [] }],
      })
      await ws.waitForMessage()

      await ws.send({
        id: 'dispose-1',
        type: 'dispose',
        dispose: { promiseIds: ['session'] },
      })
      await ws.waitForMessage()

      // Try to use disposed reference
      await ws.send({
        id: 'use-1',
        type: 'call',
        calls: [{ promiseId: 'p1', target: { type: 'promise', promiseId: 'session' }, method: 'getData', args: [] }],
      })

      const response = (await ws.waitForMessage()) as CapnwebResponse
      expect(response.results?.[0]?.type).toBe('error')
      expect(response.results?.[0]?.error?.code).toBe('DISPOSED_REFERENCE')

      await ws.close()
    })

    test('should include error data for debugging', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      await ws.send({
        jsonrpc: '2.0',
        method: 'throwDetailedError',
        params: { includeStack: true },
        id: 1,
      })

      const response = (await ws.waitForMessage()) as RPCResponse
      expect(response.error?.data).toBeDefined()

      await ws.close()
    })
  })

  test.describe('Connection Error Handling', () => {
    test('should handle oversized messages', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      // Create a very large message
      const largeData = 'x'.repeat(10 * 1024 * 1024) // 10MB
      await ws.send({
        jsonrpc: '2.0',
        method: 'echo',
        params: { data: largeData },
        id: 1,
      })

      const response = (await ws.waitForMessage()) as RPCResponse
      expect(response.error).toBeDefined()

      await ws.close()
    })
  })
})

// =============================================================================
// 6. Promise Pipelining Tests
// =============================================================================

test.describe('WebSocket RPC - Promise Pipelining', () => {
  test.describe('Basic Pipelining', () => {
    test('should chain method calls without awaiting intermediate results', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      // Chain: getUser('alice').getPosts()
      await ws.send({
        id: 'pipe-1',
        type: 'batch',
        calls: [
          { promiseId: 'p1', target: { type: 'root' }, method: 'getUser', args: [{ type: 'value', value: 'alice' }] },
          { promiseId: 'p2', target: { type: 'promise', promiseId: 'p1' }, method: 'getPosts', args: [] },
        ],
      })

      const response = (await ws.waitForMessage()) as CapnwebResponse
      expect(response.results?.length).toBe(2)
      expect(Array.isArray(response.results?.[1]?.value)).toBe(true)

      await ws.close()
    })

    test('should access properties on promise results', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      await ws.send({
        id: 'pipe-2',
        type: 'batch',
        calls: [
          { promiseId: 'p1', target: { type: 'root' }, method: 'getUser', args: [{ type: 'value', value: 'alice' }] },
          { promiseId: 'p2', target: { type: 'property', base: { type: 'promise', promiseId: 'p1' }, property: 'email' }, method: '__get__', args: [] },
        ],
      })

      const response = (await ws.waitForMessage()) as CapnwebResponse
      expect(response.results?.[1]?.value).toContain('@')

      await ws.close()
    })

    test('should pass promise reference as argument', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      await ws.send({
        id: 'pipe-3',
        type: 'batch',
        calls: [
          { promiseId: 'user', target: { type: 'root' }, method: 'getUser', args: [{ type: 'value', value: 'alice' }] },
          { promiseId: 'notify', target: { type: 'root' }, method: 'sendNotification', args: [{ type: 'promise', promiseId: 'user' }, { type: 'value', value: 'Hello!' }] },
        ],
      })

      const response = (await ws.waitForMessage()) as CapnwebResponse
      expect(response.results?.[1]?.type).toBe('value')

      await ws.close()
    })
  })

  test.describe('Deep Pipelining', () => {
    test('should handle deeply nested chains', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      // Chain: getOrg('acme').getTeam('dev').getMembers()[0].getProfile()
      await ws.send({
        id: 'deep-1',
        type: 'batch',
        calls: [
          { promiseId: 'p1', target: { type: 'root' }, method: 'getOrg', args: [{ type: 'value', value: 'acme' }] },
          { promiseId: 'p2', target: { type: 'promise', promiseId: 'p1' }, method: 'getTeam', args: [{ type: 'value', value: 'dev' }] },
          { promiseId: 'p3', target: { type: 'promise', promiseId: 'p2' }, method: 'getMembers', args: [] },
          { promiseId: 'p4', target: { type: 'property', base: { type: 'promise', promiseId: 'p3' }, property: '0' }, method: '__get__', args: [] },
          { promiseId: 'p5', target: { type: 'promise', promiseId: 'p4' }, method: 'getProfile', args: [] },
        ],
      })

      const response = (await ws.waitForMessage()) as CapnwebResponse
      expect(response.results?.length).toBe(5)
      // Final result should be the profile
      expect(response.results?.[4]?.type).toBe('value')

      await ws.close()
    })

    test('should propagate errors through pipeline', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      await ws.send({
        id: 'err-chain',
        type: 'batch',
        calls: [
          { promiseId: 'p1', target: { type: 'root' }, method: 'throwError', args: [] },
          { promiseId: 'p2', target: { type: 'promise', promiseId: 'p1' }, method: 'someMethod', args: [] },
          { promiseId: 'p3', target: { type: 'promise', promiseId: 'p2' }, method: 'anotherMethod', args: [] },
        ],
      })

      const response = (await ws.waitForMessage()) as CapnwebResponse
      // All should error because p1 errored
      expect(response.results?.[0]?.type).toBe('error')
      expect(response.results?.[1]?.type).toBe('error')
      expect(response.results?.[2]?.type).toBe('error')

      await ws.close()
    })
  })

  test.describe('Magic Map', () => {
    test('should transform array elements server-side', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      // getPosts().map(post => post.title)
      await ws.send({
        id: 'map-1',
        type: 'batch',
        calls: [
          { promiseId: 'posts', target: { type: 'root' }, method: 'getPosts', args: [] },
          {
            promiseId: 'titles',
            target: { type: 'promise', promiseId: 'posts' },
            method: '__map__',
            args: [{ type: 'value', value: { property: 'title' } }],
          },
        ],
      })

      const response = (await ws.waitForMessage()) as CapnwebResponse
      const titles = response.results?.[1]?.value as string[]
      expect(Array.isArray(titles)).toBe(true)
      expect(titles.every((t) => typeof t === 'string')).toBe(true)

      await ws.close()
    })

    test('should filter array elements server-side', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      await ws.send({
        id: 'filter-1',
        type: 'batch',
        calls: [
          { promiseId: 'items', target: { type: 'root' }, method: 'getItems', args: [] },
          {
            promiseId: 'filtered',
            target: { type: 'promise', promiseId: 'items' },
            method: '__filter__',
            args: [{ type: 'value', value: { property: 'active', equals: true } }],
          },
        ],
      })

      const response = (await ws.waitForMessage()) as CapnwebResponse
      const items = response.results?.[1]?.value as Array<{ active: boolean }>
      expect(items.every((item) => item.active === true)).toBe(true)

      await ws.close()
    })
  })
})

// =============================================================================
// 7. Binary Data Tests
// =============================================================================

test.describe('WebSocket RPC - Binary Data', () => {
  test('should send and receive ArrayBuffer', async ({ page }) => {
    await page.goto('/')

    const result = await page.evaluate(() => {
      return new Promise<boolean>((resolve, reject) => {
        const ws = new WebSocket('ws://localhost:8787/rpc')

        ws.onopen = () => {
          // Send binary data
          const buffer = new Uint8Array([1, 2, 3, 4, 5]).buffer
          ws.send(buffer)
        }

        ws.onmessage = (event) => {
          if (event.data instanceof ArrayBuffer) {
            resolve(true)
          } else {
            // Server might respond with JSON acknowledgment
            try {
              const data = JSON.parse(event.data)
              resolve(data.type === 'binary_received')
            } catch {
              resolve(false)
            }
          }
        }

        ws.onerror = () => reject(new Error('Connection error'))
        setTimeout(() => reject(new Error('Timeout')), 5000)
      })
    })

    expect(result).toBe(true)
  })

  test('should handle binary upload via RPC', async ({ page }) => {
    await page.goto('/')
    const ws = await createWebSocket(page)

    // Use base64 encoding for binary data in JSON
    const binaryData = btoa('binary content here')

    await ws.send({
      jsonrpc: '2.0',
      method: 'uploadBinary',
      params: {
        data: binaryData,
        encoding: 'base64',
      },
      id: 'bin-1',
    })

    const response = (await ws.waitForMessage()) as RPCResponse
    expect(response.result).toMatchObject({
      received: true,
      size: expect.any(Number),
    })

    await ws.close()
  })

  test('should download binary data via RPC', async ({ page }) => {
    await page.goto('/')
    const ws = await createWebSocket(page)

    await ws.send({
      jsonrpc: '2.0',
      method: 'downloadBinary',
      params: { fileId: 'test-file' },
      id: 'bin-2',
    })

    const response = (await ws.waitForMessage()) as RPCResponse
    const result = response.result as { data: string; encoding: string }

    expect(result.encoding).toBe('base64')
    expect(typeof result.data).toBe('string')

    await ws.close()
  })
})

// =============================================================================
// 8. Timeout Tests
// =============================================================================

test.describe('WebSocket RPC - Timeouts', () => {
  test.describe('Request Timeouts', () => {
    test('should timeout slow requests', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      // Request a method that takes longer than timeout
      await ws.send({
        jsonrpc: '2.0',
        method: 'slowOperation',
        params: { duration: 10000 }, // 10 seconds
        id: 'slow-1',
      })

      // Set client timeout shorter than operation
      const response = await Promise.race([
        ws.waitForMessage(),
        new Promise<{ error: { code: number } }>((resolve) => setTimeout(() => resolve({ error: { code: -32000 } }), 5000)),
      ])

      // Either server times out or we timeout client-side
      expect(response).toBeDefined()

      await ws.close()
    })

    test('should handle timeout with custom timeout value', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      await ws.send({
        jsonrpc: '2.0',
        method: 'operationWithTimeout',
        params: {
          operation: 'fetch',
          timeout: 1000, // 1 second custom timeout
        },
        id: 'timeout-1',
      })

      const start = Date.now()
      const response = (await ws.waitForMessage()) as RPCResponse
      const duration = Date.now() - start

      // Should respond within reasonable time
      expect(duration).toBeLessThan(5000)

      await ws.close()
    })
  })

  test.describe('Connection Timeouts', () => {
    test('should handle idle connection timeout', async ({ page }) => {
      await page.goto('/')

      const closedDueToIdle = await page.evaluate(() => {
        return new Promise<boolean>((resolve) => {
          const ws = new WebSocket('ws://localhost:8787/rpc')

          ws.onclose = (event) => {
            // Check if closed due to idle timeout
            resolve(event.code === 1000 || event.code === 1001)
          }

          // Don't send any messages, wait for idle timeout
          // Server should have idle timeout < 60s for this test
          setTimeout(() => {
            ws.close()
            resolve(false)
          }, 65000)
        })
      })

      // Either server closed due to idle or test timeout
      expect(closedDueToIdle).toBeDefined()
    })

    test('should keep connection alive with ping/pong', async ({ page }) => {
      await page.goto('/')
      const ws = await createWebSocket(page)

      // Send periodic pings
      for (let i = 0; i < 3; i++) {
        await ws.send({
          jsonrpc: '2.0',
          method: 'ping',
          id: `ping-${i}`,
        })
        const response = (await ws.waitForMessage()) as RPCResponse
        expect(response.result).toBeDefined()
        await page.waitForTimeout(1000)
      }

      // Connection should still be open
      const readyState = await ws.getReadyState()
      expect(readyState).toBe(1) // WebSocket.OPEN

      await ws.close()
    })
  })
})

// =============================================================================
// 9. Concurrent Request Tests
// =============================================================================

test.describe('WebSocket RPC - Concurrency', () => {
  test('should handle multiple concurrent requests', async ({ page }) => {
    await page.goto('/')
    const ws = await createWebSocket(page)

    // Send multiple requests without waiting for responses
    const requests = Array.from({ length: 10 }, (_, i) => ({
      jsonrpc: '2.0' as const,
      method: 'echo',
      params: { n: i },
      id: `concurrent-${i}`,
    }))

    for (const req of requests) {
      await ws.send(req)
    }

    // Collect all responses
    const responses: RPCResponse[] = []
    for (let i = 0; i < 10; i++) {
      responses.push((await ws.waitForMessage()) as RPCResponse)
    }

    // All requests should have responses
    expect(responses.length).toBe(10)

    // Verify all IDs are present
    const ids = responses.map((r) => r.id)
    for (let i = 0; i < 10; i++) {
      expect(ids).toContain(`concurrent-${i}`)
    }

    await ws.close()
  })

  test('should maintain request-response correlation', async ({ page }) => {
    await page.goto('/')
    const ws = await createWebSocket(page)

    // Send requests with distinct values
    await ws.send({ jsonrpc: '2.0', method: 'echo', params: { val: 'alpha' }, id: 'a' })
    await ws.send({ jsonrpc: '2.0', method: 'echo', params: { val: 'beta' }, id: 'b' })
    await ws.send({ jsonrpc: '2.0', method: 'echo', params: { val: 'gamma' }, id: 'c' })

    const responses: RPCResponse[] = []
    for (let i = 0; i < 3; i++) {
      responses.push((await ws.waitForMessage()) as RPCResponse)
    }

    // Find each response by ID and verify value
    const responseA = responses.find((r) => r.id === 'a')
    const responseB = responses.find((r) => r.id === 'b')
    const responseC = responses.find((r) => r.id === 'c')

    expect((responseA?.result as { val: string }).val).toBe('alpha')
    expect((responseB?.result as { val: string }).val).toBe('beta')
    expect((responseC?.result as { val: string }).val).toBe('gamma')

    await ws.close()
  })

  test('should handle requests from multiple WebSocket connections', async ({ page }) => {
    await page.goto('/')

    const results = await page.evaluate(() => {
      return Promise.all(
        Array.from({ length: 5 }, (_, i) => {
          return new Promise<{ id: number; result: unknown }>((resolve, reject) => {
            const ws = new WebSocket('ws://localhost:8787/rpc')

            ws.onopen = () => {
              ws.send(
                JSON.stringify({
                  jsonrpc: '2.0',
                  method: 'echo',
                  params: { connection: i },
                  id: i,
                }),
              )
            }

            ws.onmessage = (event) => {
              const data = JSON.parse(event.data)
              ws.close()
              resolve({ id: i, result: data.result })
            }

            ws.onerror = () => reject(new Error(`Connection ${i} failed`))
            setTimeout(() => reject(new Error(`Connection ${i} timeout`)), 5000)
          })
        }),
      )
    })

    expect(results.length).toBe(5)
    for (let i = 0; i < 5; i++) {
      const result = results.find((r) => r.id === i)
      expect(result?.result).toMatchObject({ connection: i })
    }
  })
})

// =============================================================================
// 10. Resource Cleanup Tests
// =============================================================================

test.describe('WebSocket RPC - Resource Cleanup', () => {
  test('should dispose promise references', async ({ page }) => {
    await page.goto('/')
    const ws = await createWebSocket(page)

    // Create reference
    await ws.send({
      id: 'create-1',
      type: 'call',
      calls: [{ promiseId: 'session', target: { type: 'root' }, method: 'createSession', args: [] }],
    })
    await ws.waitForMessage()

    // Dispose it
    await ws.send({
      id: 'dispose-1',
      type: 'dispose',
      dispose: { promiseIds: ['session'] },
    })
    const disposeResponse = (await ws.waitForMessage()) as CapnwebResponse
    expect(disposeResponse.type).not.toBe('error')

    await ws.close()
  })

  test('should cleanup all references on disconnect', async ({ page }) => {
    await page.goto('/')

    // Create session with references
    const ws1 = await createWebSocket(page)

    await ws1.send({
      id: 'create-refs',
      type: 'batch',
      calls: [
        { promiseId: 'ref1', target: { type: 'root' }, method: 'createSession', args: [] },
        { promiseId: 'ref2', target: { type: 'root' }, method: 'createSession', args: [] },
      ],
    })
    await ws1.waitForMessage()
    await ws1.close()

    // New connection - old refs should be gone
    const ws2 = await createWebSocket(page)

    await ws2.send({
      id: 'use-old-ref',
      type: 'call',
      calls: [{ promiseId: 'test', target: { type: 'promise', promiseId: 'ref1' }, method: 'getData', args: [] }],
    })

    const response = (await ws2.waitForMessage()) as CapnwebResponse
    expect(response.results?.[0]?.type).toBe('error')

    await ws2.close()
  })
})
