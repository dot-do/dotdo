/**
 * WebSocket Mock for Testing
 *
 * Provides a mock WebSocketPair implementation for test environments.
 * This allows testing WebSocket-based code without the Cloudflare runtime.
 *
 * @module streaming/tests/utils/websocket-mock
 */

/**
 * Mock WebSocketPair that mimics Cloudflare's WebSocketPair behavior.
 * Creates a pair of connected mock WebSockets where messages sent on one
 * are received by the other.
 */
export class MockWebSocketPair {
  0: MockWebSocket
  1: MockWebSocket

  constructor() {
    // Shared messages array - when server sends, client receives
    const clientMessages: Array<{ data: string; timestamp: number }> = []
    const serverMessages: Array<{ data: string; timestamp: number }> = []

    // Create sockets with cross-references
    // socket0 = client, socket1 = server
    // When server (socket1) sends, client (socket0) receives in clientMessages
    // When client (socket0) sends, server (socket1) receives in serverMessages
    let socket0: MockWebSocket, socket1: MockWebSocket
    socket0 = createMockSocket(false, () => socket1, clientMessages, serverMessages)
    socket1 = createMockSocket(true, () => socket0, serverMessages, clientMessages)

    this[0] = socket0
    this[1] = socket1
  }
}

/**
 * Mock WebSocket interface for testing
 */
export interface MockWebSocket {
  send: MockFunction & ((data: string) => void)
  close: MockFunction & ((code?: number, reason?: string) => void)
  addEventListener: (event: string, handler: (data: any) => void) => void
  removeEventListener: (event: string, handler: (data: any) => void) => void
  messages: Array<{ data: string; timestamp: number }>
  isOpen: boolean
  closeCode: number | undefined
  closeReason: string | undefined
  simulateMessage: (data: string) => void
  simulateError: (error: Error) => void
  simulateClose: (code: number, reason: string) => void
  _handlers: Map<string, Set<(data: any) => void>>
  _customSendImpl: ((data: string) => void) | null
}

/**
 * Mock function interface compatible with vitest
 */
export interface MockFunction {
  mock: {
    calls: any[][]
    results: any[]
    instances: any[]
    invocationCallOrder: number[]
  }
  _isMockFunction: boolean
  getMockName: () => string
  mockName: () => string
  mockClear: () => void
  mockImplementation?: (fn: Function) => MockFunction
}

/**
 * Creates a mock WebSocket with test utilities
 */
function createMockSocket(
  isServer: boolean,
  otherSocket: () => MockWebSocket | undefined,
  myMessages: Array<{ data: string; timestamp: number }>,
  otherMessages: Array<{ data: string; timestamp: number }>
): MockWebSocket {
  const handlers: Map<string, Set<(data: any) => void>> = new Map()
  let isOpen = true
  let closeCode: number | undefined
  let closeReason: string | undefined

  const socket: any = {
    // Core WebSocket methods - send to OTHER socket's messages
    send: function (data: string) {
      if (!isOpen) throw new Error('WebSocket is closed')
      // When sending, the OTHER socket receives it in their messages
      otherMessages.push({ data, timestamp: Date.now() })
      // Also trigger message handlers on other side
      const other = otherSocket()
      if (other) {
        other._handlers?.get('message')?.forEach((h: Function) => h({ data }))
      }
      // Track this send in the OTHER socket's mock.calls for test assertions
      // This allows tests to check ws.send.mock.calls even though server sends
      if (other && other.send && other.send.mock && other.send.mock.calls) {
        other.send.mock.calls.push([data])
      }
      // If the OTHER socket has a custom send implementation, call it too
      // This allows tests to mock client.send and track server sends
      if (other && other._customSendImpl) {
        other._customSendImpl(data)
      }
    },
    close: null as any, // Will be set below as a mock
    _closeImpl: function (code?: number, reason?: string) {
      isOpen = false
      closeCode = code
      closeReason = reason
      handlers.get('close')?.forEach((h) => h({ code, reason }))
      // Track this close in the OTHER socket's mock.calls for test assertions
      const other = otherSocket()
      if (other && other.close && other.close.mock && other.close.mock.calls) {
        other.close.mock.calls.push([code, reason])
      }
    },
    addEventListener: function (event: string, handler: (data: any) => void) {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)!.add(handler)
    },
    removeEventListener: function (event: string, handler: (data: any) => void) {
      handlers.get(event)?.delete(handler)
    },

    // Test utilities - matching createMockWebSocket from tests
    // Messages received BY this socket (sent from other socket)
    get messages() {
      return myMessages
    },
    get isOpen() {
      return isOpen
    },
    get closeCode() {
      return closeCode
    },
    get closeReason() {
      return closeReason
    },
    simulateMessage: function (data: string) {
      // Client simulates sending a message TO the server
      // This triggers server's message handlers
      const other = otherSocket()
      if (other) {
        other._handlers?.get('message')?.forEach((h: Function) => h({ data }))
      }
    },
    simulateError: function (error: Error) {
      // Simulate error on both sockets
      handlers.get('error')?.forEach((h) => h(error))
      const other = otherSocket()
      if (other) {
        other._handlers?.get('error')?.forEach((h: Function) => h(error))
      }
    },
    simulateClose: function (code: number, reason: string) {
      isOpen = false
      closeCode = code
      closeReason = reason
      handlers.get('close')?.forEach((h) => h({ code, reason }))
      // Also trigger on the other socket
      const other = otherSocket()
      if (other) {
        other._handlers?.get('close')?.forEach((h: Function) => h({ code, reason }))
      }
    },

    // For internal access to handlers
    _handlers: handlers,
  }

  // Create a wrapper for send that acts like a vi.fn() mock
  const mockCalls: any[][] = []
  const originalSend = socket.send.bind(socket)

  const sendMock: any = function (...args: any[]) {
    mockCalls.push(args)
    return originalSend(...args)
  }

  sendMock.mock = { calls: mockCalls, results: [], instances: [], invocationCallOrder: [] }
  // Make vitest recognize this as a mock function
  sendMock._isMockFunction = true
  sendMock.getMockName = () => 'sendMock'
  sendMock.mockName = sendMock.getMockName
  sendMock.mockClear = function () {
    mockCalls.length = 0
    // Clear messages this socket has RECEIVED (from the other socket)
    myMessages.length = 0
  }
  sendMock.mockImplementation = function (fn: Function) {
    // Store custom implementation so the OTHER socket can call it
    socket._customSendImpl = fn
    const wrapperFn: any = function (...args: any[]) {
      mockCalls.push(args)
      // Still add to other's messages for compatibility
      try {
        otherMessages.push({ data: args[0], timestamp: Date.now() })
      } catch {}
      return fn(...args)
    }
    wrapperFn.mock = { calls: mockCalls }
    wrapperFn.mockClear = sendMock.mockClear
    wrapperFn.mockImplementation = sendMock.mockImplementation
    socket.send = wrapperFn
    return wrapperFn
  }

  socket.send = sendMock
  socket._customSendImpl = null // Will be set by mockImplementation

  // Create close mock similar to send mock
  const closeMockCalls: any[][] = []
  const closeMock: any = function (...args: any[]) {
    closeMockCalls.push(args)
    return socket._closeImpl(...args)
  }
  closeMock.mock = { calls: closeMockCalls, results: [], instances: [], invocationCallOrder: [] }
  closeMock._isMockFunction = true
  closeMock.getMockName = () => 'closeMock'
  closeMock.mockName = closeMock.getMockName
  closeMock.mockClear = function () {
    closeMockCalls.length = 0
  }
  socket.close = closeMock

  return socket as MockWebSocket
}

/**
 * Install the WebSocket mock globally.
 * Call this in test setup files.
 *
 * @example
 * ```typescript
 * // In vitest.setup.ts or test file
 * import { installWebSocketMock } from './streaming/tests/utils/websocket-mock'
 * installWebSocketMock()
 * ```
 */
export function installWebSocketMock(): void {
  if (typeof WebSocketPair === 'undefined') {
    ;(globalThis as any).WebSocketPair = MockWebSocketPair
  }
}

/**
 * Check if WebSocketPair is available (either native or mocked)
 */
export function isWebSocketPairAvailable(): boolean {
  return typeof WebSocketPair !== 'undefined'
}

// Type declaration for global WebSocketPair
declare global {
  var WebSocketPair: new () => { 0: WebSocket; 1: WebSocket }
}
