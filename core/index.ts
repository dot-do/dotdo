// @dotdo/core - Foundational DO runtime

// Re-export types from @org.ai/types
export type {
  WorkflowContextType,
  RelationshipOperatorType,
  ParsedFieldType,
  AIFunctionType,
  EventHandlerType,
} from '@org.ai/types'

// Core DO class with schema extension
export { DOCore, DOEnv } from './DO'
export type { DOEnv as DOCoreEnv } from './DO'
export { default as DO } from './DO'

// Schema extension API
export { DB, extendSchema } from './DB'

// WorkflowContext factory and types
export {
  createWorkflowContext,
  type WorkflowContext,
  type WorkflowContextConfig,
  type EventHandler,
  type ScheduleHandler,
  type HandlerRegistration,
  type HandlerOptions,
  type Unsubscribe,
  type RetryPolicy,
  type TryOptions,
  type DoOptions,
  getHandlers,
  dispatchEvent,
} from './context'

// RPC transport layer
export {
  // RPC Target (server-side)
  createRpcTarget,
  handleRpcRequest,
  isRpcRequest,
  isInternalMember,
  DOBaseRpcTarget,
  RpcTarget,
  newWorkersRpcResponse,
  type RpcTargetOptions,
  type RpcSessionOptions,

  // REST Router
  RestRouter,
  getRestRoutes,
  createRouterFromClass,
  jsonResponse,
  errorResponse,
  notFoundResponse,
  badRequestResponse,
  serverErrorResponse,
  type HttpMethod,
  type RouteConfig,
  type RouteContext,
  type RouteMiddleware,
  type RouterOptions,
  type JsonLdResponse,
  type ErrorResponse,
  type RestMethodConfig,
  type DOClassWithRest,

  // RPC Client (client-side)
  createClient,
  createClientSync,
  disposeSession,
  disposeAllSessions,
  getStub,
  getStubById,
  createStub,
  type RpcClient,
  type RpcPromise,
  type RpcError,
  type ClientOptions,
  type ClientConfig,
  type SessionOptions,
  type DOStub,
} from './rpc'
