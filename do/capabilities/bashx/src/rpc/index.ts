/**
 * Shell RPC Implementation Module
 *
 * Exports ShellApiImpl, ShellStreamImpl, Cap'n Web RPC integration,
 * authentication layer, and rate limiting utilities for Node.js environments.
 *
 * @packageDocumentation
 */

// Core implementations
export { ShellApiImpl, createShellApi } from './shell-api-impl.js'
export { ShellStreamImpl } from './shell-stream-impl.js'

// Authentication layer
export {
  // Main implementation
  AuthenticatedShellApiImpl,
  // Factory functions
  createAuthenticatedShellApi,
  createMemoryValidator,
  // Types
  type AuthToken,
  type TokenValidator,
  type AuthenticatedShellApi,
} from './auth.js'

// Rate limiting
export {
  RateLimiter,
  RateLimitedShellApi,
  RateLimitError,
  withRateLimit,
  createRateLimiter,
  type RateLimitConfig,
  type RateLimitStats,
} from './rate-limiter.js'

// Cap'n Web RPC integration
export {
  // Base RpcTarget class
  RpcTarget,
  // ShellApi RpcTarget wrapper
  ShellApiRpcTarget,
  // ShellStream RpcTarget wrapper
  ShellStreamRpcTarget,
  // HTTP RPC handler
  newWorkersRpcResponse,
  // WebSocket RPC handler
  handleWebSocketRpc,
  // Factory functions
  createShellApiRpcTarget,
  asRpcTarget,
  // Types
  type RpcMethodHandler,
  type RpcRequest,
  type RpcResponse,
  type RpcBatchResponse,
  type WebSocketRpcOptions,
} from './capnweb-integration.js'
