/**
 * Cap'n Web compatibility layer
 *
 * This module provides typed wrappers around capnweb functions.
 * We avoid importing capnweb's types directly to prevent TypeScript's
 * deep type instantiation issues with capnweb's recursive generic types.
 *
 * @internal
 */

/**
 * Session options for Cap'n Web RPC
 */
export type SessionOptions = {
  onSendError?: (error: Error) => Error | void
}

// We use dynamic require/import to avoid TypeScript analyzing capnweb's types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _capnweb: any = null

function getCapnweb() {
  if (!_capnweb) {
    // Use require for synchronous loading in CJS, or dynamic import for ESM
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _capnweb = require('capnweb')
  }
  return _capnweb
}

/**
 * Create a WebSocket RPC session
 */
export function newWebSocketRpcSession(
  url: string,
  localMain?: unknown,
  options?: SessionOptions
): unknown {
  return getCapnweb().newWebSocketRpcSession(url, localMain, options)
}

/**
 * Create an HTTP batch RPC session
 */
export function newHttpBatchRpcSession(url: string, options?: SessionOptions): unknown {
  return getCapnweb().newHttpBatchRpcSession(url, options)
}
