/**
 * RPC Client Cleanup Tests (TDD RED Phase)
 *
 * Tests to verify that RpcClient properly cleans up pending calls on disconnect.
 * These tests verify proper cleanup behavior - they should PASS against the current
 * implementation which handles cleanup correctly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Use vi.hoisted to create a shared array that both the mock and tests can access
const { wsInstances, getMockWs, resetWs } = vi.hoisted(() => {
  const instances: any[] = []
  return {
    wsInstances: instances,
    getMockWs: () => instances[instances.length - 1],
    resetWs: () => { instances.length = 0 }
  }
})

// Mock the ws module with the class defined inline
vi.mock('ws', () => {
  class MockWebSocket {
    readyState: number = 0 // CONNECTING
    url: string
    options?: { headers?: Record<string, string> }

    private eventHandlers: Map<string, ((...args: any[]) => void)[]> = new Map()

    send = vi.fn()
    close = vi.fn(function(this: any, code?: number, reason?: string) {
      this.readyState = 3 // CLOSED
      // Simulate async close event
      setImmediate(() => {
        const handlers = this.eventHandlers.get('close')
        if (handlers) {
          handlers.forEach((h: any) => h(code ?? 1000, Buffer.from(reason ?? 'closed')))
        }
      })
    })

    constructor(url: string, options?: { headers?: Record<string, string> }) {
      this.url = url
      this.options = options
      wsInstances.push(this)
    }

    on(event: string, handler: (...args: any[]) => void): MockWebSocket {
      if (!this.eventHandlers.has(event)) {
        this.eventHandlers.set(event, [])
      }
      this.eventHandlers.get(event)!.push(handler)
      return this
    }

    // Internal method to trigger events
    _triggerEvent(event: string, ...args: any[]): boolean {
      const handlers = this.eventHandlers.get(event)
      if (handlers) {
        handlers.forEach(h => h(...args))
        return true
      }
      return false
    }
  }

  return { default: MockWebSocket }
})

// Import RpcClient AFTER the mock is set up
import { RpcClient } from '../src/rpc-client.js'

// Helper type for the mocked WebSocket
interface MockedWebSocket {
  url: string
  options?: { headers?: Record<string, string> }
  readyState: number
  send: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  on(event: string, handler: (...args: any[]) => void): MockedWebSocket
  _triggerEvent(event: string, ...args: any[]): boolean
}

// Helper functions to manipulate mock WebSocket
function simulateOpen(ws: MockedWebSocket) {
  ws.readyState = 1 // OPEN
  ws._triggerEvent('open')
}

function simulateResponse(ws: MockedWebSocket, id: string, result: unknown) {
  ws._triggerEvent('message', JSON.stringify({
    id,
    type: 'response',
    result,
  }))
}

function simulateConnectionDrop(ws: MockedWebSocket, code = 1006, reason = 'Connection lost') {
  ws.readyState = 3 // CLOSED
  ws._triggerEvent('close', code, Buffer.from(reason))
}

function simulateError(ws: MockedWebSocket, error: Error) {
  ws._triggerEvent('error', error)
}

describe('RpcClient cleanup on disconnect', () => {
  let client: RpcClient
  let mockWs: MockedWebSocket

  beforeEach(() => {
    vi.useFakeTimers()
    resetWs()

    client = new RpcClient({
      url: 'wss://test.api.dotdo.dev/ws/rpc',
      timeout: 5000,
      autoReconnect: false,
      batchWindow: 0, // Disable batching to test immediate send behavior
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  /**
   * Helper to connect and get mock WebSocket
   */
  async function connectClient(): Promise<MockedWebSocket> {
    const connectPromise = client.connect()

    // Wait for WebSocket instantiation
    await vi.advanceTimersByTimeAsync(0)

    mockWs = getMockWs() as MockedWebSocket
    simulateOpen(mockWs)

    // Respond to introspect call
    await vi.advanceTimersByTimeAsync(0)
    const introspectCall = JSON.parse(mockWs.send.mock.calls[0][0])
    simulateResponse(mockWs, introspectCall.id, {
      name: 'Test',
      fields: [],
      methods: [],
    })

    await connectPromise
    return mockWs
  }

  describe('1. Pending calls rejected on disconnect', () => {
    it('should reject all pending calls with appropriate error when disconnect() is called', async () => {
      await connectClient()

      // Make several calls that won't be responded to
      const call1 = client.call(['test', 'method1'], [])
      const call2 = client.call(['test', 'method2'], [])
      const call3 = client.call(['test', 'method3'], [])

      // Disconnect while calls are pending
      client.disconnect()

      // All pending calls should be rejected with 'Connection closed' error
      await expect(call1).rejects.toThrow('Connection closed')
      await expect(call2).rejects.toThrow('Connection closed')
      await expect(call3).rejects.toThrow('Connection closed')
    })

    it('should reject pending calls immediately on disconnect, not wait for timeout', async () => {
      await connectClient()

      const callStartTime = Date.now()
      const pendingCall = client.call(['slow', 'method'], [])

      // Disconnect immediately
      client.disconnect()

      // Should reject immediately, not after timeout
      const rejection = await pendingCall.catch(e => e)
      const elapsed = Date.now() - callStartTime

      expect(rejection).toBeInstanceOf(Error)
      expect(rejection.message).toBe('Connection closed')
      // Should not wait for the 5000ms timeout
      expect(elapsed).toBeLessThan(100)
    })
  })

  describe('2. pendingCalls Map cleared after disconnect', () => {
    it('should have empty pendingCalls Map after disconnect()', async () => {
      await connectClient()

      // Make calls and catch rejections to prevent unhandled rejection warnings
      const call1 = client.call(['test', 'method'], []).catch(() => {})
      const call2 = client.call(['test', 'method2'], []).catch(() => {})

      // Verify calls are pending (access private member via any cast for testing)
      const clientAny = client as any
      expect(clientAny.pendingCalls.size).toBe(2)

      // Disconnect
      client.disconnect()

      // Map should be cleared
      expect(clientAny.pendingCalls.size).toBe(0)

      // Wait for promise rejections to settle
      await call1
      await call2
    })

    it('should have empty pendingCalls Map after connection drop', async () => {
      await connectClient()

      // Make calls and catch rejections
      const call = client.call(['test', 'method'], []).catch(() => {})

      const clientAny = client as any
      expect(clientAny.pendingCalls.size).toBe(1)

      // Simulate unexpected connection drop
      simulateConnectionDrop(mockWs)

      // Wait for close event to be processed
      await vi.advanceTimersByTimeAsync(0)

      // Map should be cleared
      expect(clientAny.pendingCalls.size).toBe(0)

      // Wait for promise to settle
      await call
    })
  })

  describe('3. No lingering timeouts after disconnect', () => {
    it('should clear all call timeouts on disconnect()', async () => {
      await connectClient()

      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')

      // Make multiple calls (each creates a timeout)
      const call1 = client.call(['test', 'method1'], []).catch(() => {})
      const call2 = client.call(['test', 'method2'], []).catch(() => {})
      const call3 = client.call(['test', 'method3'], []).catch(() => {})

      const initialClearCount = clearTimeoutSpy.mock.calls.length

      // Disconnect
      client.disconnect()

      // Should have called clearTimeout for each pending call
      expect(clearTimeoutSpy.mock.calls.length - initialClearCount).toBe(3)

      // Wait for promises to settle
      await Promise.all([call1, call2, call3])
    })

    it('should not fire timeout callbacks after disconnect', async () => {
      await connectClient()

      const timeoutError = vi.fn()

      // Make a call and track if timeout fires
      const call = client.call(['test', 'method'], []).catch((e) => {
        if (e.message.includes('timeout')) {
          timeoutError()
        }
      })

      // Disconnect
      client.disconnect()

      // Advance past the timeout period
      await vi.advanceTimersByTimeAsync(10000)

      // Wait for the promise to settle
      await call

      // Timeout callback should NOT have fired (we got disconnect error, not timeout)
      expect(timeoutError).not.toHaveBeenCalled()
    })

    it('should not have memory leaks from uncleaned timeouts', async () => {
      await connectClient()

      const clientAny = client as any

      // Make calls
      const call = client.call(['test', 'method'], []).catch(() => {})

      // Capture timeout reference before disconnect
      const pendingCall = Array.from(clientAny.pendingCalls.values())[0]
      const timeoutRef = (pendingCall as any)?.timeout

      // Verify timeout exists
      expect(timeoutRef).toBeDefined()

      // Disconnect
      client.disconnect()

      // After disconnect, pendingCalls should be empty (timeouts cleared)
      expect(clientAny.pendingCalls.size).toBe(0)

      // Wait for promise to settle
      await call
    })
  })

  describe('4. Reconnection does not carry over old pending calls', () => {
    it('should not have any pending calls from previous connection after reconnect', async () => {
      // First connection
      await connectClient()

      const clientAny = client as any

      // Make calls on first connection
      const call = client.call(['test', 'method'], []).catch(() => {})
      expect(clientAny.pendingCalls.size).toBe(1)

      // Connection drops
      simulateConnectionDrop(mockWs)
      await vi.advanceTimersByTimeAsync(0)

      // Verify cleanup happened
      expect(clientAny.pendingCalls.size).toBe(0)

      // Wait for the call to be rejected
      await call

      // Reconnect (create new client since autoReconnect is false)
      const client2 = new RpcClient({
        url: 'wss://test.api.dotdo.dev/ws/rpc',
        timeout: 5000,
        autoReconnect: false,
      })

      const connectPromise2 = client2.connect()
      await vi.advanceTimersByTimeAsync(0)

      const mockWs2 = getMockWs() as MockedWebSocket
      simulateOpen(mockWs2)
      await vi.advanceTimersByTimeAsync(0)

      const introspectCall2 = JSON.parse(mockWs2.send.mock.calls[0][0])
      simulateResponse(mockWs2, introspectCall2.id, {
        name: 'Test',
        fields: [],
        methods: [],
      })

      await connectPromise2

      // New connection should have clean state (only introspect was made and resolved)
      const client2Any = client2 as any
      expect(client2Any.pendingCalls.size).toBe(0)
    })

    it('should reject old calls and not deliver responses to new calls', async () => {
      await connectClient()

      // Make a call and track rejection
      let rejectedWith: Error | null = null
      const call1Promise = client.call(['test', 'method'], []).catch(e => {
        rejectedWith = e
        return null
      })

      // Get the call ID
      const call1Message = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])
      const call1Id = call1Message.id

      // Connection drops before response
      simulateConnectionDrop(mockWs)
      await vi.advanceTimersByTimeAsync(0)

      // Wait for promise to settle
      await call1Promise

      // Old call should be rejected with 'Connection closed'
      expect(rejectedWith).toBeInstanceOf(Error)
      expect(rejectedWith?.message).toBe('Connection closed')

      // Now simulate a scenario where late response arrives (shouldn't happen but test robustness)
      // The old mockWs is closed, so this tests internal state cleanup
      const clientAny = client as any
      expect(clientAny.pendingCalls.has(call1Id)).toBe(false)
    })

    it('should maintain separate message ID space after reconnect', async () => {
      await connectClient()

      // Make call on first connection
      const call = client.call(['test', 'method'], []).catch(() => {})

      const firstCallMessage = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])
      const firstId = firstCallMessage.id

      // Connection drops
      simulateConnectionDrop(mockWs)
      await vi.advanceTimersByTimeAsync(0)
      await call

      // New client
      const client2 = new RpcClient({
        url: 'wss://test.api.dotdo.dev/ws/rpc',
        timeout: 5000,
        autoReconnect: false,
      })

      const connectPromise2 = client2.connect()
      await vi.advanceTimersByTimeAsync(0)

      const mockWs2 = getMockWs() as MockedWebSocket
      simulateOpen(mockWs2)
      await vi.advanceTimersByTimeAsync(0)

      const introspectCall2 = JSON.parse(mockWs2.send.mock.calls[0][0])
      simulateResponse(mockWs2, introspectCall2.id, {
        name: 'Test',
        fields: [],
        methods: [],
      })

      await connectPromise2

      // Make call on second connection
      const call2 = client2.call(['test', 'method'], []).catch(() => {})

      const secondCallMessage = JSON.parse(mockWs2.send.mock.calls[mockWs2.send.mock.calls.length - 1][0])
      const secondId = secondCallMessage.id

      // IDs should be different (no ID collision)
      expect(firstId).not.toBe(secondId)

      // Cleanup
      client2.disconnect()
      await call2
    })
  })

  describe('5. Explicit disconnect vs connection drop cleanup', () => {
    it('should clean up the same way for explicit disconnect() call', async () => {
      await connectClient()

      const clientAny = client as any
      const disconnectedHandler = vi.fn()
      client.on('disconnected', disconnectedHandler)

      // Make pending calls
      const call = client.call(['test', 'method'], []).catch(() => 'caught')
      expect(clientAny.pendingCalls.size).toBe(1)

      // Explicit disconnect
      client.disconnect()

      // Pending calls should be cleared
      expect(clientAny.pendingCalls.size).toBe(0)

      // Call should be rejected
      const result = await call
      expect(result).toBe('caught')

      // State should be disconnected
      expect(client.getState()).toBe('disconnected')
    })

    it('should clean up the same way for unexpected connection drop', async () => {
      await connectClient()

      const clientAny = client as any
      const disconnectedHandler = vi.fn()
      client.on('disconnected', disconnectedHandler)

      // Make pending calls
      const call = client.call(['test', 'method'], []).catch(() => 'caught')
      expect(clientAny.pendingCalls.size).toBe(1)

      // Simulate connection drop (server closes, network failure, etc.)
      simulateConnectionDrop(mockWs, 1006, 'Connection abnormally closed')
      await vi.advanceTimersByTimeAsync(0)

      // Pending calls should be cleared
      expect(clientAny.pendingCalls.size).toBe(0)

      // Call should be rejected
      const result = await call
      expect(result).toBe('caught')

      // Should have emitted disconnected event
      expect(disconnectedHandler).toHaveBeenCalled()
    })

    it('should clean up when connection errors then closes', async () => {
      await connectClient()

      const clientAny = client as any
      const errorHandler = vi.fn()
      client.on('error', errorHandler)

      // Make pending calls
      const call = client.call(['test', 'method'], []).catch(() => 'caught')
      expect(clientAny.pendingCalls.size).toBe(1)

      // Simulate error followed by close
      simulateError(mockWs, new Error('Network error'))
      simulateConnectionDrop(mockWs, 1006, 'Connection failed')
      await vi.advanceTimersByTimeAsync(0)

      // Error should be emitted
      expect(errorHandler).toHaveBeenCalled()

      // Pending calls should still be cleaned up
      expect(clientAny.pendingCalls.size).toBe(0)

      // Call should be rejected
      const result = await call
      expect(result).toBe('caught')
    })

    it('should handle rapid disconnect/reconnect cycles without leaking', async () => {
      const localClient = new RpcClient({
        url: 'wss://test.api.dotdo.dev/ws/rpc',
        timeout: 5000,
        autoReconnect: true, // Enable auto-reconnect
        batchWindow: 0, // Disable batching to test immediate send behavior
      })

      const clientAny = localClient as any

      // First connect
      const connectPromise = localClient.connect()
      await vi.advanceTimersByTimeAsync(0)

      let localMockWs = getMockWs() as MockedWebSocket
      simulateOpen(localMockWs)
      await vi.advanceTimersByTimeAsync(0)

      const introspectCall = JSON.parse(localMockWs.send.mock.calls[0][0])
      simulateResponse(localMockWs, introspectCall.id, {
        name: 'Test',
        fields: [],
        methods: [],
      })

      await connectPromise

      // Make calls and catch rejections
      const calls = []
      for (let i = 0; i < 5; i++) {
        calls.push(localClient.call(['test', 'method'], [i]).catch(() => {}))
      }

      expect(clientAny.pendingCalls.size).toBe(5)

      // Rapid disconnect
      simulateConnectionDrop(localMockWs)
      await vi.advanceTimersByTimeAsync(0)

      // Should have cleaned up
      expect(clientAny.pendingCalls.size).toBe(0)

      // Wait for all calls to settle
      await Promise.all(calls)

      // Auto-reconnect will be scheduled, advance to trigger it
      await vi.advanceTimersByTimeAsync(2000)

      // New WebSocket should be created
      const newMockWs = getMockWs() as MockedWebSocket

      if (newMockWs !== localMockWs) {
        // Simulate successful reconnection
        simulateOpen(newMockWs)
        await vi.advanceTimersByTimeAsync(0)

        if (newMockWs.send.mock.calls.length > 0) {
          const introCall = JSON.parse(newMockWs.send.mock.calls[0][0])
          simulateResponse(newMockWs, introCall.id, {
            name: 'Test',
            fields: [],
            methods: [],
          })
        }
        await vi.advanceTimersByTimeAsync(0)
      }

      // After reconnect, should have clean state (no leaked pending calls)
      expect(clientAny.pendingCalls.size).toBe(0)

      // Clean up
      localClient.disconnect()
    })
  })

  describe('Edge cases', () => {
    it('should handle disconnect when no pending calls exist', async () => {
      await connectClient()

      const clientAny = client as any
      expect(clientAny.pendingCalls.size).toBe(0)

      // Disconnect should not throw
      expect(() => client.disconnect()).not.toThrow()

      expect(clientAny.pendingCalls.size).toBe(0)
    })

    it('should handle multiple disconnect calls gracefully', async () => {
      await connectClient()

      // Make a call and catch rejection
      const call = client.call(['test', 'method'], []).catch(() => {})

      // Multiple disconnects should not throw
      client.disconnect()
      expect(() => client.disconnect()).not.toThrow()
      expect(() => client.disconnect()).not.toThrow()

      const clientAny = client as any
      expect(clientAny.pendingCalls.size).toBe(0)

      // Wait for call to settle
      await call
    })

    it('should reject new calls made during disconnect', async () => {
      await connectClient()

      // Start disconnect
      client.disconnect()

      // Try to make a call while disconnecting/disconnected
      await expect(client.call(['test', 'method'], [])).rejects.toThrow('Not connected')
    })

    it('should handle cleanup when call times out before disconnect', async () => {
      await connectClient()

      const clientAny = client as any

      // Make a call and track result
      let rejectedWith: Error | null = null
      const callPromise = client.call(['test', 'method'], []).catch(e => {
        rejectedWith = e
        return null
      })

      // Let the call timeout
      await vi.advanceTimersByTimeAsync(6000) // timeout is 5000ms

      // Wait for promise to settle
      await callPromise

      // Call should have timed out
      expect(rejectedWith).toBeInstanceOf(Error)
      expect(rejectedWith?.message).toContain('timeout')

      // pendingCalls should be empty (timeout cleaned it up)
      expect(clientAny.pendingCalls.size).toBe(0)

      // Now disconnect should not try to reject the same call
      expect(() => client.disconnect()).not.toThrow()
    })
  })
})
