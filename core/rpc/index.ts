/**
 * @dotdo/core/rpc - RPC Transport Layer
 *
 * Unified RPC infrastructure for Durable Object communication.
 * Supports both Cap'n Web RPC (promise pipelining) and standard
 * Cloudflare Workers RPC (stub.methodName()).
 *
 * Features:
 * - Cap'n Web RPC target for exposing DO methods
 * - REST router using Hono
 * - RPC client factory with session management
 * - Internal member filtering for security
 *
 * @module @dotdo/core/rpc
 */

// ============================================================================
// RPC TARGET (Server-side)
// ============================================================================

export {
  // Target creation
  createRpcTarget,
  handleRpcRequest,
  isRpcRequest,
  isInternalMember,

  // Base class for RPC targets
  DOBaseRpcTarget,

  // Re-exports from capnweb
  RpcTarget,
  newWorkersRpcResponse,

  // Types
  type RpcTargetOptions,
  type RpcSessionOptions,
} from './target'

// ============================================================================
// REST ROUTER
// ============================================================================

export {
  // Router class
  RestRouter,

  // Route utilities
  getRestRoutes,
  createRouterFromClass,

  // Response helpers
  jsonResponse,
  errorResponse,
  notFoundResponse,
  badRequestResponse,
  serverErrorResponse,

  // Types
  type HttpMethod,
  type RouteConfig,
  type RouteContext,
  type RouteMiddleware,
  type RouterOptions,
  type JsonLdResponse,
  type ErrorResponse,
  type RestMethodConfig,
  type DOClassWithRest,
} from './router'

// ============================================================================
// RPC CLIENT (Client-side)
// ============================================================================

export {
  // Client factory
  createClient,
  createClientSync,

  // Session management
  disposeSession,
  disposeAllSessions,

  // Workers RPC helpers
  getStub,
  getStubById,
  createStub,

  // Types
  type RpcClient,
  type RpcPromise,
  type RpcError,
  type ClientOptions,
  type ClientConfig,
  type SessionOptions,
  type DOStub,
} from './client'
