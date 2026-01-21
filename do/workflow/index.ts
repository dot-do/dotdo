/**
 * WorkflowContext DSL Module
 *
 * Standalone module for the WorkflowContext ($) that provides:
 * - Event handlers: $.on.Customer.signup(handler)
 * - Scheduling: $.every.Monday.at('9am')(handler)
 * - Cross-DO RPC: $.Customer(id).method()
 * - Durability levels: $.send(), $.try(), $.do()
 *
 * @module do/workflow
 */

// Core context factory and types
export {
  createContext,
  type WorkflowContext,
  type $,
  type DoOptions,
  type DOStubFactory,
  type CreateContextOptions,
  // Primitive capability types (do-ibsi)
  type FsCapability,
  type GitCapability,
  type BashCapability,
  type NpmCapability,
  type PrimitivesConfig,
} from './context'

// Event handler DSL ($.on.Noun.verb)
export {
  createOnProxy,
  matchHandlers,
  invokeHandlers,
  getEventTypes,
  getHandlerCount,
  clearHandlers,
  clearAllHandlers,
  type EventHandler,
  type OnProxy,
  type NounEventProxy,
  type RetryOptions,
  type HandlerResult,
  type InvokeHandlersResult,
} from './events'

// Scheduling DSL ($.every.Monday.at9am)
export {
  createEveryProxy,
  getSchedules,
  getScheduleCount,
  clearSchedules,
  executeSchedule,
  type ScheduleHandler,
  type ScheduleInterval,
  type ScheduleRegistration,
} from './schedule'

// Cross-DO RPC ($.Customer(id))
export {
  createDOAccessor,
  createDORPCProxy,
  hasStub,
  clearStub,
  clearAllStubs,
  getStubCount,
  type DOStubProxy,
  type CrossDORPCConfig,
  // Circuit breaker configuration (do-fcxj)
  type CircuitBreakerRPCConfig,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
} from './rpc'

// Async context propagation (do-nexi)
export {
  runWithWorkflowContext,
  runWithWorkflowContextSync,
  getCurrentWorkflowContext,
  getCurrentRequestContext,
  getContextMetadata,
  setContextMetadata,
  getRequestId,
  hasWorkflowContext,
  wrapHandler,
  initializeAsyncContext,
  resetAsyncContext,
  type RequestScopedContext,
} from './async-context'
