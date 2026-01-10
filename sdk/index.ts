/**
 * SDK - Client SDKs for dotdo
 *
 * Cap'n Web RPC client with WebSocket-first + HTTP batch fallback.
 * Provides automatic promise pipelining for optimal performance.
 *
 * @module sdk
 */

export {
  // Main exports
  $,
  $Context,
  configure,
  // Session management
  disposeSession,
  disposeAllSessions,
  // Types
  type ChainStep, // @deprecated - kept for backwards compatibility
  type RpcError,
  type RpcPromise,
  type RpcClient,
  type SdkConfig,
} from './client.js'
