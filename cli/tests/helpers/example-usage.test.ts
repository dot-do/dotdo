/**
 * Example Usage of Shared Test Helpers
 *
 * This file demonstrates how to use the shared test utilities from helpers/index.ts
 * and helpers/render.ts in your test files.
 *
 * Migration guide: To refactor an existing test file to use these helpers:
 * 1. Keep vi.hoisted() inline (required by vitest hoisting semantics)
 * 2. Import and use createWebSocketMock() in vi.mock()
 * 3. Replace local simulate* functions with imports from helpers/index.ts
 * 4. Use SAMPLE_DATA for common fixtures
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// =============================================================================
// Setup: vi.hoisted() must define state inline due to hoisting semantics
// =============================================================================

// NOTE: vi.hoisted runs before imports, so we must define state inline.
// The helper createWebSocketMockState() shows the pattern but can't be
// called inside vi.hoisted. However, the WebSocket mock class itself CAN
// be extracted to the helpers module.

const { wsInstances, getMockWs, resetWs } = vi.hoisted(() => {
  const instances: any[] = []
  return {
    wsInstances: instances,
    getMockWs: () => instances[instances.length - 1],
    resetWs: () => { instances.length = 0 }
  }
})

// Import the mock factory and use it in vi.mock
// This extracts the ~45 lines of MockWebSocket class definition
import {
  createWebSocketMock,
  // WebSocket event simulation
  simulateOpen,
  simulateResponse,
  simulateErrorResponse,
  simulateConnectionDrop,
  simulateCallback,
  simulateEvent,
  // Sample data fixtures
  SAMPLE_DATA,
  // Helper to connect a test client
  connectTestClient,
  // Keyboard context for input testing
  createKeyboardContext,
  // Types
  type MockedWebSocket,
} from './index.js'

vi.mock('ws', () => createWebSocketMock(wsInstances))

// =============================================================================
// Import the module under test AFTER mocks are set up
// =============================================================================
import { RpcClient } from '../../src/rpc-client.js'

// =============================================================================
// Example Test Suite
// =============================================================================

describe('Example: Using Shared Test Helpers', () => {
  let client: RpcClient
  let mockWs: MockedWebSocket

  beforeEach(() => {
    vi.useFakeTimers()
    resetWs()

    client = new RpcClient({
      url: 'wss://test.api.dotdo.dev/ws/rpc',
      timeout: 5000,
      autoReconnect: false,
      batchWindow: 0,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  /**
   * BEFORE: Manual connect helper (20+ lines per test file)
   * async function connectClient(): Promise<MockedWebSocket> {
   *   const connectPromise = client.connect()
   *   await vi.advanceTimersByTimeAsync(0)
   *   mockWs = getMockWs() as MockedWebSocket
   *   simulateOpen(mockWs)
   *   await vi.advanceTimersByTimeAsync(0)
   *   const introspectCall = JSON.parse(mockWs.send.mock.calls[0][0])
   *   simulateResponse(mockWs, introspectCall.id, { name: 'Test', fields: [], methods: [] })
   *   await connectPromise
   *   return mockWs
   * }
   *
   * AFTER: Use connectTestClient helper
   */
  async function connectClient(): Promise<MockedWebSocket> {
    return connectTestClient(client, getMockWs)
  }

  describe('Using SAMPLE_DATA fixtures', () => {
    it('should use schema fixtures from SAMPLE_DATA', async () => {
      // BEFORE: Inline schema definition in each test
      // const schema = { name: 'Test', fields: [], methods: [] }

      // AFTER: Use shared fixture
      const schema = SAMPLE_DATA.SCHEMA.MINIMAL
      mockWs = await connectTestClient(client, getMockWs, schema)

      expect(client.getSchema()).toEqual(schema)
    })

    it('should use rich schema with methods', async () => {
      const schema = SAMPLE_DATA.SCHEMA.WITH_METHODS
      mockWs = await connectTestClient(client, getMockWs, schema)

      expect(client.getSchema()?.methods.length).toBe(2)
      expect(client.getSchema()?.methods[0].name).toBe('getOrders')
    })

    it('should use customer fixtures', async () => {
      mockWs = await connectClient()

      // Make a call and return sample customer data
      const callPromise = client.call(['customers', 'get'], ['cust_alice_001'])
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      // Use SAMPLE_DATA for response fixture
      simulateResponse(mockWs, callMsg.id, SAMPLE_DATA.CUSTOMERS.ALICE)

      const result = await callPromise
      expect(result).toEqual(SAMPLE_DATA.CUSTOMERS.ALICE)
    })
  })

  describe('Using WebSocket simulation helpers', () => {
    it('should use simulateResponse helper', async () => {
      mockWs = await connectClient()

      const callPromise = client.call(['test', 'method'], ['arg1'])
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      // BEFORE: Manual JSON.stringify and _triggerEvent
      // mockWs._triggerEvent('message', JSON.stringify({ id: callMsg.id, type: 'response', result: { success: true } }))

      // AFTER: Use simulateResponse helper
      simulateResponse(mockWs, callMsg.id, { success: true })

      const result = await callPromise
      expect(result).toEqual({ success: true })
    })

    it('should use simulateErrorResponse helper', async () => {
      mockWs = await connectClient()

      const callPromise = client.call(['test', 'method'], [])
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      // BEFORE: Manual error response
      // mockWs._triggerEvent('message', JSON.stringify({ id: callMsg.id, type: 'response', error: { message: 'Failed', code: 'ERR' } }))

      // AFTER: Use simulateErrorResponse helper
      simulateErrorResponse(mockWs, callMsg.id, { message: 'Not found', code: 'NOT_FOUND' })

      await expect(callPromise).rejects.toThrow('Not found')
    })

    it('should use simulateConnectionDrop helper', async () => {
      mockWs = await connectClient()

      const callPromise = client.call(['test', 'method'], []).catch((e) => e)

      // BEFORE: Manual close simulation
      // mockWs.readyState = 3
      // mockWs._triggerEvent('close', 1006, Buffer.from('Connection lost'))

      // AFTER: Use simulateConnectionDrop helper
      simulateConnectionDrop(mockWs)

      await vi.advanceTimersByTimeAsync(0)

      const error = await callPromise
      expect(error.message).toBe('Connection closed')
    })

    it('should use simulateCallback helper for streaming', async () => {
      mockWs = await connectClient()

      const onProgress = vi.fn()
      const callPromise = client.call(['tasks', 'run'], [{ onProgress }])
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])
      const callbackId = callMsg.args[0].onProgress.__rpc_callback_id

      // BEFORE: Manual callback message
      // mockWs._triggerEvent('message', JSON.stringify({ id: `cb_${Date.now()}`, type: 'callback', callbackId, args: [50, 'Halfway'] }))

      // AFTER: Use simulateCallback helper
      simulateCallback(mockWs, callbackId, [50, 'Halfway done'])

      expect(onProgress).toHaveBeenCalledWith(50, 'Halfway done')

      // Complete the call
      simulateResponse(mockWs, callMsg.id, { taskId: 'task_1' })
      await callPromise
    })

    it('should use simulateEvent helper', async () => {
      mockWs = await connectClient()

      const eventHandler = vi.fn()
      client.on('event', eventHandler)

      // BEFORE: Manual event simulation
      // mockWs._triggerEvent('message', JSON.stringify({ id: `evt_${Date.now()}`, type: 'event', eventType: 'customer.created', data: { ... } }))

      // AFTER: Use simulateEvent helper
      simulateEvent(mockWs, 'customer.created', SAMPLE_DATA.CUSTOMERS.ALICE)

      expect(eventHandler).toHaveBeenCalledWith({
        type: 'customer.created',
        data: SAMPLE_DATA.CUSTOMERS.ALICE,
      })
    })
  })

  describe('Using keyboard context helper', () => {
    it('should create keyboard context with defaults', () => {
      // BEFORE: Manual context creation
      // const context = {
      //   value: '',
      //   cursorPosition: 0,
      //   history: [],
      //   historyIndex: -1,
      //   ...many more fields...
      //   onChange: vi.fn(),
      //   onSubmit: vi.fn(),
      //   ...more mocks...
      // }

      // AFTER: Use createKeyboardContext helper
      const context = createKeyboardContext()

      expect(context.value).toBe('')
      expect(context.focused).toBe(true)
      expect(typeof context.onChange).toBe('function')

      // Test mock functions work
      context.onChange('new value')
      expect(context.onChange).toHaveBeenCalledWith('new value')
    })

    it('should create keyboard context with overrides', () => {
      const context = createKeyboardContext({
        value: 'hello world',
        cursorPosition: 5,
        history: SAMPLE_DATA.HISTORY.BASIC, // Use shared history fixture
        showCompletions: true,
        completions: SAMPLE_DATA.COMPLETIONS.PROMISE_METHODS, // Use shared completions
      })

      expect(context.value).toBe('hello world')
      expect(context.cursorPosition).toBe(5)
      expect(context.history).toEqual(SAMPLE_DATA.HISTORY.BASIC)
      expect(context.completions).toEqual(SAMPLE_DATA.COMPLETIONS.PROMISE_METHODS)
    })
  })
})

describe('Example: Before/After Code Comparison', () => {
  /**
   * This section shows line-by-line comparison of old vs new approach.
   * The new approach significantly reduces boilerplate.
   *
   * LINES OF CODE COMPARISON (per test file):
   *
   * Old approach:
   * - vi.hoisted block: ~10 lines
   * - vi.mock('ws') with MockWebSocket class: ~45 lines
   * - MockedWebSocket interface: ~8 lines
   * - simulateOpen function: ~4 lines
   * - simulateResponse function: ~9 lines
   * - simulateErrorResponse function: ~12 lines
   * - simulateConnectionDrop function: ~4 lines
   * - connectClient helper: ~18 lines
   * TOTAL: ~110 lines of boilerplate per test file
   *
   * New approach:
   * - Import statement: ~15 lines (but provides much more)
   * - vi.hoisted with createWebSocketMockState: 1 line
   * - vi.mock with createWebSocketMock: 1 line
   * - connectClient using connectTestClient: 3 lines
   * TOTAL: ~20 lines, with access to all helpers
   *
   * SAVINGS: ~90 lines per test file
   * With 10+ RPC test files, that's ~900 lines of duplicated code eliminated
   */

  it('demonstrates the simplified setup', () => {
    // This test exists to document the benefits
    expect(true).toBe(true)
  })
})
