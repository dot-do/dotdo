/**
 * Cap'n Web compatibility layer
 *
 * This module provides typed wrappers around capnweb functions.
 * We use a minimal type interface to avoid TypeScript's deep type
 * instantiation issues with capnweb's recursive generic types.
 *
 * The capnweb library is imported at runtime, but we define our own
 * simplified types to prevent TypeScript from analyzing the full
 * recursive type definitions.
 *
 * @internal
 */

/**
 * Session options for Cap'n Web RPC
 */
export type SessionOptions = {
  onSendError?: (error: Error) => Error | void
}

/**
 * Minimal type interface for capnweb functions.
 * This avoids importing capnweb's recursive types directly.
 */
interface CapnWebModule {
  newWebSocketRpcSession(url: string, localMain?: unknown, options?: SessionOptions): unknown
  newHttpBatchRpcSession(url: string, options?: SessionOptions): unknown
}

// Import capnweb with type assertion to avoid deep type analysis.
// Using `import * as` with type assertion prevents TypeScript from
// analyzing capnweb's recursive generic types while allowing Vite
// to properly alias the import in test environments.
import * as capnwebModule from 'capnweb'
const capnweb = capnwebModule as unknown as CapnWebModule

/**
 * Create a WebSocket RPC session
 *
 * @param url - WebSocket URL (wss:// or ws://)
 * @param localMain - Optional local object to expose to the remote
 * @param options - Session options
 * @returns RPC stub for the remote object
 */
export function newWebSocketRpcSession(
  url: string,
  localMain?: unknown,
  options?: SessionOptions
): unknown {
  return capnweb.newWebSocketRpcSession(url, localMain, options)
}

/**
 * Create an HTTP batch RPC session
 *
 * @param url - HTTP URL for batch RPC endpoint
 * @param options - Session options
 * @returns RPC stub for the remote object
 */
export function newHttpBatchRpcSession(url: string, options?: SessionOptions): unknown {
  return capnweb.newHttpBatchRpcSession(url, options)
}
