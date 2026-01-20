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

// WebSocket management - standalone reusable module (do-rljr.1)
export {
  WebSocketManager,
  type WebSocketMessage,
  type WebSocketHandler,
  type BroadcastResult,
  type ConnectionMetadata,
  type ConnectionHandler
} from './websocket'

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

// EventSystem - Standalone event handling module (do-rljr.3)
export {
  EventSystem,
  createEventSystem,
  type EventPayload,
  type EventEmitListener,
  type EventSystemOptions,
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

// Extended primitives with AI assistance (fsx, gitx, bashx)
export {
  // File System Extended
  FSX,
  createFSX,
  fsx,
  type FileInfo,
  type ReadOptions,
  type WriteOptions,
  type ListOptions,
  type CopyMoveOptions,
  type AIFileResult,
  type FSXAIOptions,

  // Git Extended
  GitX,
  createGitX,
  gitx,
  type Commit,
  type Branch,
  type FileStatus,
  type RepoStatus,
  type DiffInfo,
  type DiffHunk,
  type DiffLine,
  type CommitOptions,
  type BranchOptions,
  type MergeOptions,
  type AIGitOptions,
  type AICommitMessage,
  type AIReviewResult,

  // Bash Extended
  BashX,
  createBashX,
  bashx,
  type ExecResult,
  type ExecOptions,
  type Command,
  type PipelineResult,
  type AIBashOptions,
  type AICommandResult,
  type AIDiagnosisResult,
} from './primitives'
