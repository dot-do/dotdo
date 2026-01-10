/**
 * Transport Layer Module
 *
 * Unified transport handlers for Durable Objects with:
 * - REST API (rest-autowire)
 * - MCP JSON-RPC (mcp-server)
 * - Cap'n Web RPC (rpc-server)
 * - Authentication/Authorization (auth-layer)
 *
 * @example
 * ```typescript
 * import {
 *   HandlerChain,
 *   RestHandler,
 *   McpHandler,
 *   RpcHandler,
 *   AuthHandler,
 * } from './transport'
 *
 * // Create handler chain
 * const chain = new HandlerChain({ debug: true })
 *   .use(new AuthHandler({ jwtSecret: 'secret' }), 100)
 *   .use(new McpHandler(), 50)
 *   .use(new RpcHandler(), 40)
 *   .use(new RestHandler(), 30)
 *
 * // In DO fetch handler
 * async fetch(request: Request): Promise<Response> {
 *   return chain.handle(request, createHandlerContext({
 *     env: this.env,
 *     ctx: this.ctx,
 *     state: this.state,
 *     instance: this,
 *   }))
 * }
 * ```
 */

// Core interfaces and types
export type {
  TransportHandler,
  WrappableHandler,
  MiddlewareHandler,
  HandlerContext,
  HandlerOptions,
  MethodInfo,
  AuthContext,
  CanHandleResult,
  HandlerResponse,
  Logger,
  ExecutionContext,
  DurableObjectState,
  DurableObjectId,
  DurableObjectStorage,
} from './handler'

export { BaseHandler, isWrappable, isMiddleware } from './handler'

// Shared utilities
export {
  parseJsonBody,
  parseJsonBodyOrThrow,
  buildJsonResponse,
  buildStreamingResponse,
  buildErrorResponse,
  mapErrorToStatus,
  logRequest,
  createRequestTimer,
  validateSchema,
  getCachedSchema,
  clearSchemaCache,
  extractPathParams,
  parseQueryParams,
  parseAcceptHeader,
  getBestContentType,
} from './shared'

export type {
  ParseJsonResult,
  JsonResponseOptions,
  TransportError,
  RequestLog,
  JsonSchema,
  SchemaProperty,
  ValidationResult,
} from './shared'

// Handler chain
export {
  HandlerChain,
  HandlerChainBuilder,
  wrapWithMiddleware,
  createHandlerContext,
  discoverMethods,
} from './chain'

export type { HandlerChainConfig } from './chain'

// REST handler
export { RestHandler, createRestRouter, getRestRoutes } from './rest-autowire'
export type { RestHandlerOptions } from './rest-autowire'

// MCP handler
export { McpHandler, createMcpHandler, getMcpTools, hasMcpConfig } from './mcp-server'
export type { McpHandlerOptions } from './mcp-server'

// RPC handler
export { RpcHandler, RPCServer, withRpc, applyRpcIntegration } from './rpc-server'
export type { RpcHandlerOptions } from './rpc-server'

// Auth handler
export {
  AuthHandler,
  createAuthMiddleware,
  withAuth,
  validateToken,
  checkPermission,
  checkRole,
  createRateLimiter,
  validateRequestSignature,
  createInMemorySessionStorage,
} from './auth-layer'

export type {
  AuthHandlerOptions,
  AuthMiddlewareOptions,
  MethodAuthConfig,
  AuthResult,
  ApiKeyInfo,
  SessionStorage,
  SessionData,
  RateLimitConfig,
  RateLimitStorage,
  NonceStorage,
} from './auth-layer'

// Sync engine
export { SyncEngine } from './sync-engine'
export type {
  SyncThing,
  SubscribeMessage,
  UnsubscribeMessage,
  InitialMessage,
  ChangeMessage,
} from './sync-engine'
