// @dotdo/do - THE Durable Object for Digital Objects
// DO = Durable Object = Digital Object

export { DO, type DOEnv, type DOOptions } from './DO'

// Composable mixins for building DOs (do-6epx)
export {
  // Storage mixin
  WithStorage,
  type Constructor,
  type HasStorage,
  type WithStorageOptions,
  type MixinInstance,
  // WebSocket mixin
  WithWebSocket,
  type HasWebSocket,
  type WithWebSocketOptions,
  // RPC mixin
  WithRPC,
  type HasRPC,
  type WithRPCOptions,
  type RPCRequest,
  type RPCResponse,
  // Auth mixin
  WithAuth,
  type HasAuth,
  type WithAuthOptions,
  // Composition helpers
  type ComposedType,
  type InstanceOf
} from './mixins'
export { createContext, createTypedContext } from './context'
export type { WorkflowContext, $ } from './context'
export { EntityManager, withEntities, type EntityManagerOptions } from './entities'

// Type-safe WorkflowContext types (do-ebio)
export type {
  // Core typed context
  TypedWorkflowContext,
  $Typed,

  // DO binding types
  DOBindingsConstraint,
  EmptyBindings,
  DefineDOBindings,
  DOBindingAccessors,
  TypedDOStubProxy,
  TypedDOStubFactory,
  DOStubProxy,
  DOStubFactory,
  DOTypeFromBinding,
  StubTypeForBinding,
  InferDOBindings,

  // Event schema types
  EventSchemasConstraint,
  EmptyEventSchemas,
  DefineEventSchemas,
  EventTypes,
  EventPayload,
  EventPayloadType,
  ExtractNoun,
  ExtractVerb,
  EventNouns,
  EventVerbsForNoun,
  TypedEvent,
  TypedEventHandler,
  TypedSend,

  // Typed On proxy ($.on.Noun.verb)
  TypedOnProxy,
  TypedNounEventProxy,

  // Typed Every proxy ($.every.day.at('9am'))
  TypedEveryProxy,
  ScheduleRegisterFn,
  TimeAccessor,
  DayOfWeekProxy,
  IntervalUnitProxy,
  WeekProxy,
  EveryProxy,

  // Context types
  BaseWorkflowContext,
  TypedBaseWorkflowContext,
  DoOptions,
  TypedContextConfig,
  CreateTypedContextOptions,
} from './types'

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

// Workflow module - standalone WorkflowContext DSL (do-b3pv)
// Re-export additional utilities from the workflow module
export {
  // Cross-DO RPC utilities
  createDOAccessor,
  createDORPCProxy,
  hasStub,
  clearStub,
  clearAllStubs,
  getStubCount,
  type CrossDORPCConfig,
  // Schedule utilities
  getSchedules,
  getScheduleCount,
  clearSchedules,
  executeSchedule,
  // Event handler result types
  type HandlerResult,
  type InvokeHandlersResult,
} from './workflow'

// Event handler system ($.on.Noun.verb) - backward compatible re-exports
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

// Scheduling DSL ($.every.Monday.at9am) - backward compatible re-exports
export {
  createEveryProxy,
  type ScheduleHandler,
  type ScheduleInterval,
  type ScheduleRegistration
} from './schedule'

// Fire-and-forget error tracking (do-9bmr)
export {
  createInMemoryErrorStore,
  createSQLiteErrorStore,
  extractErrorInfo,
  trackFireAndForget,
  type FireAndForgetError,
  type FireAndForgetErrorStore,
  type ErrorQueryOptions,
  type ErrorStats
} from './fire-and-forget-errors'

// WebSocket management
export {
  WebSocketManager,
  type WebSocketMessage,
  type WebSocketHandler,
  type BroadcastResult,
  type ConnectionMetadata,
  type ConnectionHandler
} from './websocket'

// WebSocket hibernation with reconnection protocol (do-hb5s)
export {
  HibernationManager,
  type HibernationAttachment,
  type HibernationState,
  type HibernationConfig,
  DEFAULT_HIBERNATION_CONFIG,
  estimateHibernationSavings,
  isHibernationError,
  createHibernationPayload,
} from './hibernation'

// WebSocket reconnection protocol (do-hb5s)
export {
  SessionManager,
  type SessionState,
  type BufferedEvent,
  type ReconnectionConfig,
  DEFAULT_RECONNECTION_CONFIG,
  RECONNECTION_PROTOCOL_VERSION,
  DEFAULT_SESSION_TIMEOUT_MS,
  DEFAULT_MAX_EVENT_BUFFER,
  type ProtocolMessage,
  type SessionInitMessage,
  type SessionResumeMessage,
  type SessionResumedMessage,
  type SessionExpiredMessage,
  type SessionErrorMessage,
  type EventMessage,
  type HeartbeatPingMessage,
  type HeartbeatPongMessage,
  type ReconnectionProtocolMessage,
  type SessionErrorCode,
  type BackoffConfig,
  DEFAULT_BACKOFF_CONFIG,
  calculateBackoffDelay,
  shouldRetry,
  type ClientReconnectionState,
  createClientState,
  handleSessionInit,
  handleSessionResumed,
  handleSessionExpired,
  handleEvent,
  handleDisconnect,
  createResumeMessage,
  shouldAttemptResume,
  getNextRetryDelay,
  parseProtocolMessage,
  isProtocolMessage,
} from './websocket-reconnection'

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
  // Caller detection (use extractCallerInfoWithVerification for security)
  detectCallerType,
  extractCallerInfo,
  extractCallerInfoWithVerification,
  // HMAC signing for DO-to-DO (do-rrb9 security fix)
  setDOInternalSecret,
  verifyDOSignature,
  // For testing only
  getDOInternalSecret,
  clearDOInternalSecret,
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
  DO_SIGNATURE_HEADER,
  DO_TIMESTAMP_HEADER,
  // Helpers (async for HMAC signing)
  addDOSourceHeaders,
  addDOSourceHeadersAsync,
  createDOToDoHeaders,
  addWorkerHeaders,
} from './auth'

// Third-party integration registry (do-laux)
export {
  IntegrationRegistry,
  IntegrationRegistryError,
  integrationRegistry,
  registerIntegration,
  getIntegration,
  successResult,
  errorResult,
  type Integration,
  type IntegrationConfig,
  type IntegrationStatus,
  type IntegrationMetadata,
  type IntegrationCategory,
  type IntegrationResult,
  type IntegrationError,
  type IntegrationEvent,
  type IntegrationWebhookHandler,
  type IntegrationFactory,
  type RegisterIntegrationOptions,
  type RegisteredIntegration,
  type ListIntegrationsOptions,
  type IntegrationSummary,
} from '../integrations'

// Example integrations
export {
  StripeIntegration,
  createStripeIntegration,
  type StripeConfig,
  type StripeCustomer,
  type StripePaymentIntent,
  type StripeSubscription,
  type StripeMethods,
} from '../integrations/stripe'

export {
  SendGridIntegration,
  createSendGridIntegration,
  type SendGridConfig,
  type EmailRecipient,
  type EmailAttachment,
  type SendEmailRequest,
  type SendEmailResponse,
  type SendGridContact,
  type EmailStats,
  type SendGridMethods,
} from '../integrations/sendgrid'

// NOTE: Extended primitives (fsx, gitx, bashx) are in v1 worktree only
// See .worktrees/v1/do/capabilities/ for reference implementations
// These will be reimplemented in v3 when needed

/**
 * Circuit Breaker pattern implementation for protecting against cascading failures.
 */
export {
  CircuitBreaker,
  CircuitBreakerRegistry,
  createCircuitBreaker,
  createCircuitBreakerRegistry,
  getGlobalCircuitBreakerRegistry,
  resetGlobalCircuitBreakerRegistry,
  type CircuitState,
  type CircuitBreakerConfig,
  type CircuitStats,
  type CircuitBreakerResult,
} from './circuit-breaker'

/**
 * Graceful Degradation for DO unavailability (do-ejab).
 *
 * Provides: health checking, response caching, write queue for retry,
 * and clear degradation status reporting to callers.
 */
export {
  HealthChecker,
  createHealthChecker,
  type HealthStatus,
  type HealthCheckResult,
  type HealthReport,
  type HealthCheckConfig,
  FallbackHandler,
  createFallbackHandler,
  type FallbackConfig,
  type FallbackContext,
  createWriteQueue,
  createWriteQueueInstance,
  type WriteQueue,
  type QueuedWrite,
  type WriteQueueConfig,
  type WriteQueueStats,
  type WriteQueueQueryOptions,
  addDegradationHeaders,
  parseDegradationHeaders,
  type DegradationMode,
  type DegradationStatus,
  type DegradedResponse,
  GracefulDegradationHandler,
  createGracefulDegradationHandler,
  EnhancedGracefulDegradationHandler,
  createEnhancedGracefulDegradationHandler,
  type EnhancedGracefulDegradationConfig,
} from './graceful-degradation'
