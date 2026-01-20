// @dotdo/do - THE Durable Object for Digital Objects
// DO = Durable Object = Digital Object

export { DO, type DOEnv, type DOOptions } from './DO'
export { createContext, type WorkflowContext } from './context'
export type { $ } from './context'
export { EntityManager, withEntities, type EntityManagerOptions } from './entities'

// Type-safe DO binding registry (do-hsfo)
export {
  // Core types
  type AnyDurableObjectNamespace,
  type DOBindingConstraint,
  type DOBindingRegistry,
  type BindingNames,
  type ValidateBindingName,
  type BindingAccessor,
  type DOBindings,
  type ExtractDOBindings,
  type BindingUnion,
  type RegistryFromNames,
  // Factory functions
  createBindingAccessor,
  // Simple helpers
  getBinding,
  getStub,
  // Runtime utilities
  isDurableObjectNamespace,
  extractDOBindings,
  asBindingRegistry,
} from './bindings'

// Re-export audit types from db for convenience
export type {
  AuditLog,
  AuditLogStore,
  AuditLogQueryOptions,
  AuditLogConfig,
  AuditContext,
  AuditLogLevel,
  AuditAction
} from '../db'

// WebSocket management
export {
  WebSocketManager,
  type WebSocketMessage,
  type WebSocketHandler,
  type BroadcastResult
} from './websocket'

// Event handler system ($.on.Noun.verb)
export {
  createOnProxy,
  matchHandlers,
  invokeHandlers,
  getEventTypes,
  getHandlerCount,
  clearHandlers,
  clearAllHandlers,
  type OnProxy,
  type EventHandler,
  type NounEventProxy
} from './on'

// Scheduling DSL ($.every.Monday.at9am)
export {
  createEveryProxy,
  type ScheduleHandler,
  type ScheduleInterval,
  type ScheduleRegistration
} from './schedule'

// Admin interface hooks
export {
  AdminDO,
  createAdminHooks,
  type AdminStores,
  type EntityListOptions,
  type EntityListResult,
  type EventListOptions,
  type EventListResult,
  type RelationshipListOptions,
  type RelationshipListResult,
  type EmitEventOptions,
  type StateInspection,
  type HealthCheck
} from './admin'

// DO-level authentication guards (do-nuwe)
export {
  // Core guard
  createDOAuthGuard,
  type DOAuthGuard,
  type DOAuthGuardConfig,
  type AuthPayload,
  type CallerInfo,
  type CallerType,
  // Caller detection
  detectCallerType,
  extractCallerInfo,
  // Hono middleware
  doAuthMiddleware,
  type DOAuthMiddlewareOptions,
  // Specialized guards
  requireWorkerCaller,
  requireDOCaller,
  requireUserCaller,
  requireInternalCaller,
  requireDOSource,
  // Headers
  CF_WORKER_HEADER,
  WORKER_NAME_HEADER,
  DO_SOURCE_HEADER,
  DO_SOURCE_ID_HEADER,
  CORRELATION_ID_HEADER,
  INTERNAL_TRUST_HEADER,
  // Helpers
  addDOSourceHeaders,
  createDOToDoHeaders,
  addWorkerHeaders,
} from './auth'
