/**
 * Shared Test Utilities for CLI Tests
 *
 * Provides reusable test infrastructure for RPC testing:
 * - createMockWebSocket() - Mock WebSocket for RPC testing
 * - createMockRpcClient() - Pre-configured RPC client for tests
 * - createTestDO() - Test DO stub factory
 * - SAMPLE_DATA - Common test fixtures
 *
 * @module cli/tests/helpers
 */

import { vi, type Mock } from 'vitest'

// =============================================================================
// Mock WebSocket Types
// =============================================================================

/**
 * Mock WebSocket interface with test helpers
 */
export interface MockedWebSocket {
  url: string
  options?: { headers?: Record<string, string> }
  readyState: number
  send: Mock
  close: Mock
  on(event: string, handler: (...args: unknown[]) => void): MockedWebSocket
  _triggerEvent(event: string, ...args: unknown[]): boolean
  _getEventHandlers(): Map<string, ((...args: unknown[]) => void)[]>
}

/**
 * WebSocket ready state constants
 */
export const WS_READY_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const

// =============================================================================
// Mock WebSocket Factory
// =============================================================================

/**
 * State for mock WebSocket instances - call reset() between tests
 */
const wsState = {
  instances: [] as MockedWebSocket[],
}

/**
 * Get the most recently created mock WebSocket
 */
export function getMockWebSocket(): MockedWebSocket | undefined {
  return wsState.instances[wsState.instances.length - 1]
}

/**
 * Get all created mock WebSocket instances
 */
export function getAllMockWebSockets(): MockedWebSocket[] {
  return [...wsState.instances]
}

/**
 * Reset mock WebSocket state - call in beforeEach
 */
export function resetMockWebSockets(): void {
  wsState.instances.length = 0
}

/**
 * Create the vi.hoisted mock setup for WebSocket
 *
 * Usage in test file:
 * ```ts
 * const { getMockWs, resetWs, wsInstances } = vi.hoisted(() => createWebSocketMockState())
 *
 * vi.mock('ws', () => createWebSocketMock(wsInstances))
 * ```
 */
export function createWebSocketMockState() {
  const instances: MockedWebSocket[] = []
  return {
    wsInstances: instances,
    getMockWs: () => instances[instances.length - 1],
    resetWs: () => {
      instances.length = 0
    },
  }
}

/**
 * Create the WebSocket mock factory for vi.mock()
 *
 * @param instances - The instances array from createWebSocketMockState()
 */
export function createWebSocketMock(instances: MockedWebSocket[]) {
  class MockWebSocket {
    readyState: number = WS_READY_STATE.CONNECTING
    url: string
    options?: { headers?: Record<string, string> }

    private eventHandlers: Map<string, ((...args: unknown[]) => void)[]> = new Map()

    send = vi.fn()
    close = vi.fn(function (this: MockedWebSocket, code?: number, reason?: string) {
      this.readyState = WS_READY_STATE.CLOSED
      // Simulate async close event
      setImmediate(() => {
        const handlers = (this as unknown as { eventHandlers: Map<string, ((...args: unknown[]) => void)[]> }).eventHandlers.get('close')
        if (handlers) {
          handlers.forEach((h) => h(code ?? 1000, Buffer.from(reason ?? 'closed')))
        }
      })
    })

    constructor(url: string, options?: { headers?: Record<string, string> }) {
      this.url = url
      this.options = options
      instances.push(this as unknown as MockedWebSocket)
    }

    on(event: string, handler: (...args: unknown[]) => void): MockWebSocket {
      if (!this.eventHandlers.has(event)) {
        this.eventHandlers.set(event, [])
      }
      this.eventHandlers.get(event)!.push(handler)
      return this
    }

    _triggerEvent(event: string, ...args: unknown[]): boolean {
      const handlers = this.eventHandlers.get(event)
      if (handlers) {
        handlers.forEach((h) => h(...args))
        return true
      }
      return false
    }

    _getEventHandlers(): Map<string, ((...args: unknown[]) => void)[]> {
      return this.eventHandlers
    }
  }

  return { default: MockWebSocket }
}

// =============================================================================
// WebSocket Event Simulation Helpers
// =============================================================================

/**
 * Simulate WebSocket open event
 */
export function simulateOpen(ws: MockedWebSocket): void {
  ws.readyState = WS_READY_STATE.OPEN
  ws._triggerEvent('open')
}

/**
 * Simulate WebSocket response message
 */
export function simulateResponse(ws: MockedWebSocket, id: string, result: unknown): void {
  ws._triggerEvent(
    'message',
    JSON.stringify({
      id,
      type: 'response',
      result,
    })
  )
}

/**
 * Simulate WebSocket error response message
 */
export function simulateErrorResponse(
  ws: MockedWebSocket,
  id: string,
  error: { message: string; code?: string }
): void {
  ws._triggerEvent(
    'message',
    JSON.stringify({
      id,
      type: 'response',
      error,
    })
  )
}

/**
 * Simulate WebSocket connection drop (close event)
 */
export function simulateConnectionDrop(
  ws: MockedWebSocket,
  code = 1006,
  reason = 'Connection lost'
): void {
  ws.readyState = WS_READY_STATE.CLOSED
  ws._triggerEvent('close', code, Buffer.from(reason))
}

/**
 * Simulate WebSocket error event
 */
export function simulateError(ws: MockedWebSocket, error: Error): void {
  ws._triggerEvent('error', error)
}

/**
 * Simulate WebSocket generic message
 */
export function simulateMessage(ws: MockedWebSocket, message: unknown): void {
  ws._triggerEvent('message', JSON.stringify(message))
}

/**
 * Simulate WebSocket raw message (non-JSON)
 */
export function simulateRawMessage(ws: MockedWebSocket, data: string): void {
  ws._triggerEvent('message', data)
}

/**
 * Simulate WebSocket callback invocation
 */
export function simulateCallback(
  ws: MockedWebSocket,
  callbackId: string,
  args: unknown[]
): void {
  ws._triggerEvent(
    'message',
    JSON.stringify({
      id: `cb_${Date.now()}`,
      type: 'callback',
      callbackId,
      args,
    })
  )
}

/**
 * Simulate WebSocket event message
 */
export function simulateEvent(
  ws: MockedWebSocket,
  eventType: string,
  data: unknown
): void {
  ws._triggerEvent(
    'message',
    JSON.stringify({
      id: `evt_${Date.now()}`,
      type: 'event',
      eventType,
      data,
    })
  )
}

/**
 * Simulate WebSocket log message (streaming)
 */
export function simulateLogMessage(
  ws: MockedWebSocket,
  correlationId: string,
  level: string,
  message: string,
  index?: number
): void {
  ws._triggerEvent(
    'message',
    JSON.stringify({
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      type: 'log',
      correlationId,
      data: { level, message, index },
    })
  )
}

// =============================================================================
// RPC Client Test Helpers
// =============================================================================

/**
 * Helper to connect a client and get the mock WebSocket
 *
 * @param client - The RpcClient instance
 * @param getMockWs - Function to get the current mock WebSocket
 * @param schema - Optional schema to return from introspection
 */
export async function connectTestClient(
  client: { connect: () => Promise<unknown> },
  getMockWs: () => MockedWebSocket,
  schema = SAMPLE_DATA.SCHEMA.MINIMAL
): Promise<MockedWebSocket> {
  const connectPromise = client.connect()

  // Wait for WebSocket instantiation
  await vi.advanceTimersByTimeAsync(0)

  const mockWs = getMockWs()
  simulateOpen(mockWs)

  // Respond to introspect call
  await vi.advanceTimersByTimeAsync(0)
  const introspectCall = JSON.parse(mockWs.send.mock.calls[0][0])
  simulateResponse(mockWs, introspectCall.id, schema)

  await connectPromise
  return mockWs
}

// =============================================================================
// Sample Data - Test Fixtures
// =============================================================================

/**
 * Common test fixtures for CLI tests
 */
export const SAMPLE_DATA = {
  /**
   * Schema fixtures
   */
  SCHEMA: {
    /** Minimal valid schema */
    MINIMAL: {
      name: 'Test',
      fields: [],
      methods: [],
    },

    /** Schema with basic fields */
    WITH_FIELDS: {
      name: 'Customer',
      fields: [
        { name: '$id', type: 'string', required: true, description: 'Unique identifier' },
        { name: 'name', type: 'string', required: true },
        { name: 'email', type: 'string', required: true },
      ],
      methods: [],
    },

    /** Schema with methods */
    WITH_METHODS: {
      name: 'Customer',
      fields: [
        { name: '$id', type: 'string', required: true },
        { name: 'name', type: 'string', required: true },
      ],
      methods: [
        {
          name: 'getOrders',
          params: [],
          returns: 'Promise<Order[]>',
        },
        {
          name: 'charge',
          params: [{ name: 'amount', type: 'number', required: true }],
          returns: 'Promise<Receipt>',
        },
      ],
    },

    /** Full-featured schema */
    FULL: {
      name: 'Customer',
      fields: [
        { name: '$id', type: 'string', required: true, description: 'Unique identifier' },
        { name: '$type', type: 'string', required: true },
        { name: 'name', type: 'string', required: true },
        { name: 'email', type: 'string', required: true },
        { name: 'nickname', type: 'string', required: false },
        { name: 'createdAt', type: 'Date', required: true },
        { name: 'tags', type: 'string[]', required: false },
      ],
      methods: [
        {
          name: 'getOrders',
          params: [],
          returns: 'Promise<Order[]>',
          description: 'Get all orders for this customer',
        },
        {
          name: 'charge',
          params: [
            { name: 'amount', type: 'number', required: true },
            { name: 'currency', type: 'string', required: false },
          ],
          returns: 'Promise<Receipt>',
          description: 'Charge the customer',
        },
        {
          name: 'notify',
          params: [{ name: 'message', type: 'string', required: true }],
          returns: 'Promise<void>',
        },
      ],
    },
  },

  /**
   * Customer fixtures
   */
  CUSTOMERS: {
    ALICE: {
      $id: 'cust_alice_001',
      $type: 'Customer',
      name: 'Alice Johnson',
      email: 'alice@example.com',
      createdAt: '2024-01-15T10:30:00Z',
    },

    BOB: {
      $id: 'cust_bob_002',
      $type: 'Customer',
      name: 'Bob Smith',
      email: 'bob@example.com',
      createdAt: '2024-01-16T14:00:00Z',
    },

    CHARLIE: {
      $id: 'cust_charlie_003',
      $type: 'Customer',
      name: 'Charlie Brown',
      email: 'charlie@example.com',
      createdAt: '2024-01-17T09:15:00Z',
    },
  },

  /**
   * Order fixtures
   */
  ORDERS: {
    ORDER_1: {
      $id: 'order_001',
      $type: 'Order',
      customerId: 'cust_alice_001',
      total: 99.99,
      status: 'completed',
    },

    ORDER_2: {
      $id: 'order_002',
      $type: 'Order',
      customerId: 'cust_bob_002',
      total: 149.50,
      status: 'pending',
    },
  },

  /**
   * Completion item fixtures
   */
  COMPLETIONS: {
    PROMISE_METHODS: [
      { name: 'then', kind: 'method', isMethod: true },
      { name: 'catch', kind: 'method', isMethod: true },
      { name: 'finally', kind: 'method', isMethod: true },
    ],

    CUSTOMER_METHODS: [
      { name: 'getOrders', kind: 'method', isMethod: true },
      { name: 'charge', kind: 'method', isMethod: true },
      { name: 'notify', kind: 'method', isMethod: true },
    ],

    OBJECT_PROPERTIES: [
      { name: '$id', kind: 'property', isMethod: false },
      { name: 'name', kind: 'property', isMethod: false },
      { name: 'email', kind: 'property', isMethod: false },
    ],
  },

  /**
   * History fixtures
   */
  HISTORY: {
    BASIC: ['echo hello', 'ls -la', 'npm test'],

    REPL_COMMANDS: [
      'customer.create({ name: "Alice" })',
      'customer.getOrders()',
      'const x = 42',
      'x * 2',
    ],

    LONG_SESSION: [
      'console.log("starting")',
      'const config = { debug: true }',
      'await db.connect()',
      'const users = await db.query("SELECT * FROM users")',
      'users.length',
      'users.map(u => u.name)',
      'await db.close()',
    ],
  },

  /**
   * RPC message fixtures
   */
  RPC: {
    /** Sample call message */
    CALL: {
      id: 'msg_test_001',
      type: 'call' as const,
      path: ['customers', 'create'],
      args: [{ name: 'Test Customer' }],
    },

    /** Sample pipeline message */
    PIPELINE: {
      id: 'msg_test_002',
      type: 'pipeline' as const,
      path: ['customers', 'get'],
      operations: [
        { path: 'customers', args: [], type: 'get' as const },
        { path: 'get', args: ['cust_001'], type: 'call' as const },
      ],
    },

    /** Sample error response */
    ERROR: {
      id: 'msg_test_003',
      type: 'response' as const,
      error: {
        message: 'Customer not found',
        code: 'NOT_FOUND',
      },
    },
  },
} as const

// =============================================================================
// Test Context Helpers
// =============================================================================

/**
 * Create a keybinding test context
 * Useful for testing keyboard handlers
 */
export function createKeyboardContext(overrides: Partial<KeyboardContext> = {}): KeyboardContext {
  return {
    value: '',
    cursorPosition: 0,
    history: [],
    historyIndex: -1,
    completions: [],
    selectedCompletion: 0,
    showCompletions: false,
    focused: true,
    multiline: false,
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    onExit: vi.fn(),
    onToggleCompletions: vi.fn(),
    onRequestCompletions: vi.fn(),
    setCursorPosition: vi.fn(),
    setHistoryIndex: vi.fn(),
    setSelectedCompletion: vi.fn(),
    ...overrides,
  }
}

/**
 * Keybinding context interface
 */
export interface KeyboardContext {
  value: string
  cursorPosition: number
  history: string[]
  historyIndex: number
  completions: Array<{ name: string; kind: string; isMethod: boolean }>
  selectedCompletion: number
  showCompletions: boolean
  focused: boolean
  multiline: boolean
  onChange: Mock
  onSubmit: Mock
  onExit: Mock
  onToggleCompletions: Mock
  onRequestCompletions: Mock
  setCursorPosition: Mock
  setHistoryIndex: Mock
  setSelectedCompletion: Mock
}

// =============================================================================
// Delay/Timing Utilities
// =============================================================================

/**
 * Promise-based delay helper
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 50
): Promise<void> {
  const startTime = Date.now()
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return
    }
    await delay(interval)
  }
  throw new Error('waitFor timeout')
}

// =============================================================================
// Re-exports for convenience
// =============================================================================

export { vi } from 'vitest'
