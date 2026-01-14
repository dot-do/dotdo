/**
 * SDK - Client SDKs for dotdo
 *
 * Cap'n Web RPC client with WebSocket-first + HTTP batch fallback.
 * Provides automatic promise pipelining for optimal performance.
 *
 * @deprecated Import from '@dotdo/client' instead
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
  // Legacy exports for backwards compatibility
  createClient,
  // Types
  type ChainStep, // @deprecated - kept for backwards compatibility
  type RpcError,
  type RpcPromise,
  type RpcClient,
  type SdkConfig,
  type DOClient,
  type ClientConfig,
  type ConnectionState,
} from '@dotdo/client'
