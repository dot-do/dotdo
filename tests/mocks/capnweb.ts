/**
 * Mock for capnweb RPC library
 *
 * Provides a mock implementation of capnweb's session creation functions
 * for testing environments where the real capnweb module has ESM/CJS
 * compatibility issues.
 *
 * The mock creates proxy objects that behave like capnweb RPC stubs:
 * - Support arbitrary property access (returns another stub)
 * - Support being called as a function (returns another stub)
 * - Support Symbol.dispose for cleanup
 * - Support onRpcBroken for connection error handling
 * - Support dup() for duplicating the stub
 * - Are thenable (can be awaited)
 */

export type SessionOptions = {
  onSendError?: (error: Error) => Error | void
}

/**
 * Creates a mock RPC stub that mimics capnweb's behavior
 */
function createMockStub(): unknown {
  const handlers = new Set<(error: unknown) => void>()

  const stub: unknown = new Proxy(function () {}, {
    get(_target, prop) {
      // Disposal
      if (prop === Symbol.dispose) {
        return () => {
          // Cleanup - notify broken handlers
        }
      }

      // Connection error handler
      if (prop === 'onRpcBroken') {
        return (handler: (error: unknown) => void) => {
          handlers.add(handler)
        }
      }

      // Duplicate stub
      if (prop === 'dup') {
        return () => createMockStub()
      }

      // Make it thenable for Promise compatibility
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => {
          // Resolve with a mock result
          resolve({ __mock: true })
        }
      }

      // Symbol.toStringTag for debugging
      if (prop === Symbol.toStringTag) {
        return 'MockRpcStub'
      }

      // Symbol.toPrimitive for string conversion
      if (prop === Symbol.toPrimitive) {
        return () => '[MockRpcStub]'
      }

      // Any other property returns another mock stub for chaining
      return createMockStub()
    },

    apply() {
      // Calling the stub as a function returns another stub
      return createMockStub()
    },

    has() {
      // All properties potentially exist
      return true
    },
  })

  return stub
}

/**
 * Create a WebSocket RPC session (mock)
 */
export function newWebSocketRpcSession(
  _url: string,
  _localMain?: unknown,
  _options?: SessionOptions
): unknown {
  return createMockStub()
}

/**
 * Create an HTTP batch RPC session (mock)
 */
export function newHttpBatchRpcSession(_url: string, _options?: SessionOptions): unknown {
  return createMockStub()
}

/**
 * Mock RpcTarget base class for DO classes to extend
 */
export class RpcTarget {
  [Symbol.dispose]() {
    // Cleanup
  }
}

/**
 * Mock for newWorkersRpcResponse (creates RPC response for Workers runtime)
 */
export function newWorkersRpcResponse(
  _target: unknown,
  _request: Request,
  _options?: unknown
): Response {
  return new Response(JSON.stringify({ __mock: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Mock for newHttpBatchRpcResponse (creates HTTP batch RPC response)
 */
export function newHttpBatchRpcResponse(
  _target: unknown,
  _request: Request,
  _options?: unknown
): Response {
  return new Response(JSON.stringify({ __mock: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Mock for newWorkersWebSocketRpcResponse (creates WebSocket RPC response)
 */
export function newWorkersWebSocketRpcResponse(
  _target: unknown,
  _request: Request,
  _options?: unknown
): Response {
  return new Response(null, { status: 101, webSocket: undefined as unknown as WebSocket })
}

// Default export for ESM compatibility
export default {
  newWebSocketRpcSession,
  newHttpBatchRpcSession,
  RpcTarget,
  newWorkersRpcResponse,
  newHttpBatchRpcResponse,
  newWorkersWebSocketRpcResponse,
}
