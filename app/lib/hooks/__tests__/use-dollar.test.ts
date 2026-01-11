/**
 * use$ Hook Tests (RED phase - TDD)
 *
 * These tests define the contract for the use$ hook - the core primitive
 * returning the $ RPC proxy for Durable Object interaction.
 *
 * Tests are expected to FAIL until the implementation is created.
 *
 * The use$ hook provides:
 * - WebSocket connection to Durable Objects
 * - $ proxy with send/try/do methods for different durability levels
 * - Cross-DO RPC calls via $.Noun(id).method()
 * - Event subscriptions via $.on.Noun.verb(handler)
 * - Scheduling via $.every.interval(handler)
 * - Promise pipelining (multiple calls in single round trip)
 * - State synchronization with optimistic updates
 *
 * ## Expected Hook Interface
 *
 * ```typescript
 * interface UseDollarOptions {
 *   doUrl: string              // WebSocket URL for the Durable Object
 *   doId?: string              // Optional DO instance ID
 *   autoConnect?: boolean      // Auto-connect on mount (default: true)
 * }
 *
 * interface UseDollarReturn {
 *   $: DollarProxy             // The $ RPC proxy
 *   isLoading: boolean         // True while connecting
 *   isConnected: boolean       // True when connected
 *   error: Error | null        // Connection error if any
 *   connect: () => void        // Manual connect
 *   disconnect: () => void     // Manual disconnect
 * }
 * ```
 *
 * @see app/lib/hooks/use-dollar.ts (implementation to be created)
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// Import the hook under test (will fail until implemented)
import { useDollar } from '../use-dollar'

// =============================================================================
// Mock WebSocket
// =============================================================================

/**
 * Creates a mock WebSocket that can simulate connection states and messages
 */
function createMockWebSocket() {
  const listeners: Record<string, Set<(event: unknown) => void>> = {
    open: new Set(),
    close: new Set(),
    message: new Set(),
    error: new Set(),
  }

  const mockWs = {
    readyState: 0, // CONNECTING
    send: vi.fn(),
    close: vi.fn(() => {
      mockWs.readyState = 3 // CLOSED
      listeners.close.forEach((fn) => fn({ code: 1000, reason: 'Normal closure' }))
    }),
    addEventListener: vi.fn((event: string, callback: (event: unknown) => void) => {
      if (!listeners[event]) listeners[event] = new Set()
      listeners[event].add(callback)
    }),
    removeEventListener: vi.fn((event: string, callback: (event: unknown) => void) => {
      listeners[event]?.delete(callback)
    }),
    // Test helpers
    _simulateOpen: () => {
      mockWs.readyState = 1 // OPEN
      listeners.open.forEach((fn) => fn({}))
    },
    _simulateClose: (code = 1000, reason = '') => {
      mockWs.readyState = 3 // CLOSED
      listeners.close.forEach((fn) => fn({ code, reason }))
    },
    _simulateError: (error: Error) => {
      listeners.error.forEach((fn) => fn({ error }))
    },
    _simulateMessage: (data: unknown) => {
      listeners.message.forEach((fn) => fn({ data: JSON.stringify(data) }))
    },
    _listeners: listeners,
  }

  return mockWs
}

type MockWebSocket = ReturnType<typeof createMockWebSocket>

// =============================================================================
// Test Setup
// =============================================================================

describe('useDollar (use$)', () => {
  let mockWs: MockWebSocket
  let originalWebSocket: typeof WebSocket

  beforeEach(() => {
    vi.clearAllMocks()

    // Save original WebSocket
    originalWebSocket = globalThis.WebSocket

    // Create mock WebSocket
    mockWs = createMockWebSocket()

    // Replace global WebSocket
    globalThis.WebSocket = vi.fn(() => mockWs) as unknown as typeof WebSocket
  })

  afterEach(() => {
    // Restore original WebSocket
    globalThis.WebSocket = originalWebSocket
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Connection Management Tests
  // ===========================================================================

  describe('connection management', () => {
    it('connects to DO via WebSocket on mount', async () => {
      renderHook(() => useDollar({ doUrl: 'wss://example.com.ai/do/123' }))

      expect(globalThis.WebSocket).toHaveBeenCalledWith(
        expect.stringContaining('wss://example.com.ai/do/123')
      )
    })

    it('returns isLoading=true while connecting', () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      // Before connection is established
      expect(result.current.isLoading).toBe(true)
      expect(result.current.isConnected).toBe(false)
    })

    it('returns isConnected=true when connected', async () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      // Simulate WebSocket open
      act(() => {
        mockWs._simulateOpen()
      })

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true)
        expect(result.current.isLoading).toBe(false)
      })
    })

    it('disconnects on unmount', () => {
      const { unmount } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      // Simulate connection
      act(() => {
        mockWs._simulateOpen()
      })

      // Unmount the hook
      unmount()

      // Should have called close
      expect(mockWs.close).toHaveBeenCalled()
    })

    it('reconnects automatically on connection loss', async () => {
      vi.useFakeTimers()

      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      // Initial connection
      act(() => {
        mockWs._simulateOpen()
      })

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true)
      })

      // Create a new mock for the reconnection
      const mockWs2 = createMockWebSocket()
      globalThis.WebSocket = vi.fn(() => mockWs2) as unknown as typeof WebSocket

      // Simulate connection loss (not intentional disconnect)
      act(() => {
        mockWs._simulateClose(1006, 'Abnormal closure')
      })

      // Should be in reconnecting state
      await waitFor(() => {
        expect(result.current.isConnected).toBe(false)
        expect(result.current.isLoading).toBe(true)
      })

      // Fast-forward reconnection timer
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      // Should have attempted to reconnect
      expect(globalThis.WebSocket).toHaveBeenCalledTimes(1)

      vi.useRealTimers()
    })

    it('returns error when connection fails', async () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      // Simulate connection error
      act(() => {
        mockWs._simulateError(new Error('Connection refused'))
        mockWs._simulateClose(1006, 'Connection failed')
      })

      await waitFor(() => {
        expect(result.current.error).toBeDefined()
        expect(result.current.error).toBeInstanceOf(Error)
        expect(result.current.isConnected).toBe(false)
      })
    })

    it('provides manual connect function', () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123', autoConnect: false })
      )

      expect(typeof result.current.connect).toBe('function')
    })

    it('provides manual disconnect function', () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      expect(typeof result.current.disconnect).toBe('function')
    })

    it('does not auto-connect when autoConnect=false', () => {
      renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123', autoConnect: false })
      )

      // Should not have created WebSocket
      expect(globalThis.WebSocket).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // $ Proxy Methods Tests
  // ===========================================================================

  describe('$ proxy methods', () => {
    beforeEach(async () => {
      // Most tests need a connected state
    })

    it('$.send(event) fires and forgets', async () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      // Connect
      act(() => {
        mockWs._simulateOpen()
      })

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true)
      })

      // Call $.send with an event
      const event = { type: 'Customer.signup', data: { email: 'test@example.com.ai' } }

      act(() => {
        result.current.$.send(event)
      })

      // Should have sent message without waiting for response
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"send"')
      )
    })

    it('$.try(action) attempts once and resolves', async () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      // Connect
      act(() => {
        mockWs._simulateOpen()
      })

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true)
      })

      // Call $.try with an action
      let tryPromise: Promise<unknown>
      act(() => {
        tryPromise = result.current.$.try({ action: 'processPayment', amount: 100 })
      })

      // Should have sent message
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"try"')
      )

      // Simulate response
      act(() => {
        mockWs._simulateMessage({
          type: 'response',
          id: expect.any(String),
          result: { success: true },
        })
      })

      // Promise should resolve
      await expect(tryPromise!).resolves.toEqual({ success: true })
    })

    it('$.do(action) retries durably', async () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      // Connect
      act(() => {
        mockWs._simulateOpen()
      })

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true)
      })

      // Call $.do with an action (durable execution)
      let doPromise: Promise<unknown>
      act(() => {
        doPromise = result.current.$.do({ action: 'sendEmail', to: 'user@example.com.ai' })
      })

      // Should have sent message with durable flag
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"do"')
      )

      // Simulate success response
      act(() => {
        mockWs._simulateMessage({
          type: 'response',
          id: expect.any(String),
          result: { sent: true },
        })
      })

      // Promise should resolve
      await expect(doPromise!).resolves.toEqual({ sent: true })
    })

    it('$.Noun(id).method() calls cross-DO RPC', async () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      // Connect
      act(() => {
        mockWs._simulateOpen()
      })

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true)
      })

      // Call cross-DO RPC
      let rpcPromise: Promise<unknown>
      act(() => {
        rpcPromise = result.current.$.Customer('cust-456').notify({ message: 'Hello' })
      })

      // Should have sent RPC message with noun, id, and method
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"noun":"Customer"')
      )
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"id":"cust-456"')
      )
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"method":"notify"')
      )

      // Simulate response
      act(() => {
        mockWs._simulateMessage({
          type: 'response',
          id: expect.any(String),
          result: { notified: true },
        })
      })

      await expect(rpcPromise!).resolves.toEqual({ notified: true })
    })

    it('$.on.Noun.verb(handler) subscribes to events', async () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      // Connect
      act(() => {
        mockWs._simulateOpen()
      })

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true)
      })

      // Subscribe to an event
      const handler = vi.fn()
      let unsubscribe: () => void

      act(() => {
        unsubscribe = result.current.$.on.Customer.signup(handler)
      })

      // Should have sent subscription message
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"subscribe"')
      )
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"event":"Customer.signup"')
      )

      // Simulate event from server
      act(() => {
        mockWs._simulateMessage({
          type: 'event',
          event: 'Customer.signup',
          data: { email: 'new@example.com.ai' },
        })
      })

      // Handler should have been called
      expect(handler).toHaveBeenCalledWith({ email: 'new@example.com.ai' })

      // Unsubscribe should be a function
      expect(typeof unsubscribe!).toBe('function')
    })

    it('$.every.interval(handler) sets up scheduling', async () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      // Connect
      act(() => {
        mockWs._simulateOpen()
      })

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true)
      })

      // Set up a schedule
      const handler = vi.fn()

      act(() => {
        result.current.$.every.hour(handler)
      })

      // Should have sent schedule registration message
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"schedule"')
      )
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"cron"')
      )
    })

    it('$.every.Monday.at9am(handler) sets up day/time scheduling', async () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      // Connect
      act(() => {
        mockWs._simulateOpen()
      })

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true)
      })

      const handler = vi.fn()

      act(() => {
        result.current.$.every.Monday.at9am(handler)
      })

      // Should have sent schedule with correct cron
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"cron":"0 9 * * 1"')
      )
    })
  })

  // ===========================================================================
  // Promise Pipelining Tests
  // ===========================================================================

  describe('promise pipelining', () => {
    it('multiple chained calls execute in single round trip', async () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      // Connect
      act(() => {
        mockWs._simulateOpen()
      })

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true)
      })

      // Make multiple calls that should be batched
      let promises: Promise<unknown>[]

      act(() => {
        promises = [
          result.current.$.Customer('c1').getProfile(),
          result.current.$.Customer('c2').getProfile(),
          result.current.$.Order('o1').getDetails(),
        ]
      })

      // Should have sent all calls in a single message (batched)
      // or with pipelining metadata
      const sendCalls = mockWs.send.mock.calls
      expect(sendCalls.length).toBeLessThanOrEqual(1)

      // Simulate batched response
      act(() => {
        mockWs._simulateMessage({
          type: 'batch-response',
          results: [
            { id: 0, result: { name: 'Customer 1' } },
            { id: 1, result: { name: 'Customer 2' } },
            { id: 2, result: { orderId: 'o1', items: [] } },
          ],
        })
      })

      // All promises should resolve
      const results = await Promise.all(promises!)
      expect(results).toHaveLength(3)
      expect(results[0]).toEqual({ name: 'Customer 1' })
      expect(results[1]).toEqual({ name: 'Customer 2' })
      expect(results[2]).toEqual({ orderId: 'o1', items: [] })
    })

    it('results are properly resolved', async () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      // Connect
      act(() => {
        mockWs._simulateOpen()
      })

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true)
      })

      // Make a call that returns nested data
      let promise: Promise<unknown>

      act(() => {
        promise = result.current.$.Inventory('warehouse-1').checkStock({ sku: 'ABC123' })
      })

      // Simulate complex response
      act(() => {
        mockWs._simulateMessage({
          type: 'response',
          id: expect.any(String),
          result: {
            sku: 'ABC123',
            quantity: 42,
            locations: [
              { zone: 'A', shelf: 1, count: 20 },
              { zone: 'B', shelf: 3, count: 22 },
            ],
          },
        })
      })

      const result2 = await promise!
      expect(result2).toEqual({
        sku: 'ABC123',
        quantity: 42,
        locations: [
          { zone: 'A', shelf: 1, count: 20 },
          { zone: 'B', shelf: 3, count: 22 },
        ],
      })
    })

    it('errors propagate correctly', async () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      // Connect
      act(() => {
        mockWs._simulateOpen()
      })

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true)
      })

      // Make a call that will fail
      let promise: Promise<unknown>

      act(() => {
        promise = result.current.$.Payment('pay-123').process({ amount: 1000 })
      })

      // Simulate error response
      act(() => {
        mockWs._simulateMessage({
          type: 'response',
          id: expect.any(String),
          error: {
            code: 'INSUFFICIENT_FUNDS',
            message: 'Card declined: insufficient funds',
          },
        })
      })

      // Promise should reject with the error
      await expect(promise!).rejects.toThrow('Card declined: insufficient funds')
    })

    it('chained method calls are pipelined', async () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      // Connect
      act(() => {
        mockWs._simulateOpen()
      })

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true)
      })

      // Make chained calls like Cap'n Proto promise pipelining
      // e.g., $.User(id).getAccount().getBalance()
      let promise: Promise<unknown>

      act(() => {
        promise = result.current.$.User('user-1').getAccount().getBalance()
      })

      // Should send a pipelined request
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"pipeline"')
      )

      // Simulate final resolved value (pipelining handled server-side)
      act(() => {
        mockWs._simulateMessage({
          type: 'response',
          id: expect.any(String),
          result: { balance: 1500.00, currency: 'USD' },
        })
      })

      await expect(promise!).resolves.toEqual({ balance: 1500.00, currency: 'USD' })
    })
  })

  // ===========================================================================
  // State Synchronization Tests
  // ===========================================================================

  describe('state synchronization', () => {
    it('state updates from DO trigger re-renders', async () => {
      const { result, rerender } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      // Connect
      act(() => {
        mockWs._simulateOpen()
      })

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true)
      })

      // Subscribe to state changes
      let stateValue: unknown = null
      const stateHandler = vi.fn((state) => {
        stateValue = state
      })

      act(() => {
        result.current.$.on.state(stateHandler)
      })

      // Simulate state update from DO
      act(() => {
        mockWs._simulateMessage({
          type: 'state',
          data: { counter: 1, items: ['a', 'b'] },
        })
      })

      expect(stateHandler).toHaveBeenCalledWith({ counter: 1, items: ['a', 'b'] })

      // Simulate another state update
      act(() => {
        mockWs._simulateMessage({
          type: 'state',
          data: { counter: 2, items: ['a', 'b', 'c'] },
        })
      })

      expect(stateHandler).toHaveBeenCalledTimes(2)
      expect(stateHandler).toHaveBeenLastCalledWith({ counter: 2, items: ['a', 'b', 'c'] })
    })

    it('optimistic updates work', async () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      // Connect
      act(() => {
        mockWs._simulateOpen()
      })

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true)
      })

      // Track state changes
      const stateUpdates: unknown[] = []
      const stateHandler = vi.fn((state) => {
        stateUpdates.push(state)
      })

      act(() => {
        result.current.$.on.state(stateHandler)
      })

      // Initial state
      act(() => {
        mockWs._simulateMessage({
          type: 'state',
          data: { counter: 0 },
        })
      })

      // Perform optimistic update
      act(() => {
        result.current.$.optimistic.update({ counter: 1 })
      })

      // Should immediately see optimistic value
      expect(stateUpdates).toContainEqual({ counter: 1 })

      // Simulate server confirmation
      act(() => {
        mockWs._simulateMessage({
          type: 'state',
          data: { counter: 1 },
          txid: 123,
        })
      })

      // State should still be correct
      expect(stateUpdates[stateUpdates.length - 1]).toEqual({ counter: 1 })
    })

    it('conflict resolution handles concurrent changes', async () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      // Connect
      act(() => {
        mockWs._simulateOpen()
      })

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true)
      })

      const stateUpdates: unknown[] = []
      const conflictHandler = vi.fn()

      act(() => {
        result.current.$.on.state((state) => stateUpdates.push(state))
        result.current.$.on.conflict(conflictHandler)
      })

      // Initial state from server
      act(() => {
        mockWs._simulateMessage({
          type: 'state',
          data: { value: 'A', version: 1 },
          txid: 1,
        })
      })

      // Client makes optimistic update
      act(() => {
        result.current.$.optimistic.update({ value: 'B', version: 2 })
      })

      // Server sends conflicting update (another client changed it)
      act(() => {
        mockWs._simulateMessage({
          type: 'state',
          data: { value: 'C', version: 2 },
          txid: 2,
        })
      })

      // Conflict handler should be called with both values
      expect(conflictHandler).toHaveBeenCalledWith({
        local: { value: 'B', version: 2 },
        remote: { value: 'C', version: 2 },
      })
    })

    it('state resyncs after reconnection', async () => {
      vi.useFakeTimers()

      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      // Connect
      act(() => {
        mockWs._simulateOpen()
      })

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true)
      })

      // Initial state
      act(() => {
        mockWs._simulateMessage({
          type: 'state',
          data: { counter: 5 },
          txid: 10,
        })
      })

      // Create new mock for reconnection
      const mockWs2 = createMockWebSocket()
      globalThis.WebSocket = vi.fn(() => mockWs2) as unknown as typeof WebSocket

      // Simulate disconnection
      act(() => {
        mockWs._simulateClose(1006, 'Connection lost')
      })

      // Advance timers for reconnection
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      // Simulate reconnection
      act(() => {
        mockWs2._simulateOpen()
      })

      // After reconnection, should request state sync with last known txid
      expect(mockWs2.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"sync"')
      )
      expect(mockWs2.send).toHaveBeenCalledWith(
        expect.stringContaining('"since":10')
      )

      vi.useRealTimers()
    })
  })

  // ===========================================================================
  // Return Value Interface Tests
  // ===========================================================================

  describe('return value interface', () => {
    it('returns $ proxy object', () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      expect(result.current.$).toBeDefined()
      expect(typeof result.current.$).toBe('object')
    })

    it('returns isLoading boolean', () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      expect(typeof result.current.isLoading).toBe('boolean')
    })

    it('returns isConnected boolean', () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      expect(typeof result.current.isConnected).toBe('boolean')
    })

    it('returns error or null', () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      expect(result.current.error === null || result.current.error instanceof Error).toBe(true)
    })

    it('returns connect function', () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      expect(typeof result.current.connect).toBe('function')
    })

    it('returns disconnect function', () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      expect(typeof result.current.disconnect).toBe('function')
    })

    it('$ proxy has send method', () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      expect(typeof result.current.$.send).toBe('function')
    })

    it('$ proxy has try method', () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      expect(typeof result.current.$.try).toBe('function')
    })

    it('$ proxy has do method', () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      expect(typeof result.current.$.do).toBe('function')
    })

    it('$ proxy has on property for event subscriptions', () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      expect(result.current.$.on).toBeDefined()
      expect(typeof result.current.$.on).toBe('object')
    })

    it('$ proxy has every property for scheduling', () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      expect(result.current.$.every).toBeDefined()
      expect(typeof result.current.$.every).toBe('object')
    })

    it('$ proxy returns callable nouns for cross-DO RPC', () => {
      const { result } = renderHook(() =>
        useDollar({ doUrl: 'wss://example.com.ai/do/123' })
      )

      // Accessing $.Customer should return a function
      expect(typeof result.current.$.Customer).toBe('function')
      expect(typeof result.current.$.Order).toBe('function')
      expect(typeof result.current.$.Inventory).toBe('function')
    })
  })
})
