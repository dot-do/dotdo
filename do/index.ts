/**
 * @dotdo/do - THE Durable Object for Digital Objects
 *
 * DO = Durable Object = Digital Object
 *
 * This package provides the core DO class and associated utilities for building
 * Durable Objects with built-in storage, events, relationships, and workflows.
 *
 * @example
 * ```typescript
 * import { DO, createTypedContext, type WorkflowContext } from '@dotdo/do'
 *
 * class MyDO extends DO {
 *   constructor(state: DurableObjectState, env: DOEnv) {
 *     super(state, env)
 *
 *     // Register event handlers
 *     this.$.on.Customer.signup(async (event) => {
 *       await this.$.send({ type: 'welcome-email', payload: event.payload })
 *     })
 *
 *     // Schedule recurring work
 *     this.$.every.day.at('9am')(async () => {
 *       await this.generateDailyReport()
 *     })
 *   }
 * }
 * ```
 *
 * @module @dotdo/do
 */

/**
 * The main DO class - THE Durable Object for Digital Objects.
 *
 * Provides built-in entity stores (things, events, relationships),
 * WebSocket management, integration registry, and the WorkflowContext ($).
 *
 * @see {@link WorkflowContext} for the $ API
 * @see {@link EntityManager} for storage operations
 */
export { DO, type DOEnv, type DOOptions } from './DO'

/**
 * Composable mixins for building DOs with specific capabilities.
 *
 * Use TypeScript mixin pattern to compose features:
 * - WithStorage: Entity stores (things, events, relationships)
 * - WithWebSocket: WebSocket connection handling
 * - WithRPC: Cross-DO RPC support
 * - WithAuth: Authentication and authorization
 *
 * @example
 * ```typescript
 * class MyDO extends WithAuth(WithRPC(WithStorage(BaseDO))) {
 *   // Has storage, RPC, and auth capabilities
 * }
 * ```
 */
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
/**
 * Creates a WorkflowContext ($) for event handling, scheduling, and cross-DO RPC.
 *
 * @see {@link createTypedContext} for type-safe DO bindings and event schemas
 */
export { createContext, createTypedContext } from './context'

/**
 * WorkflowContext ($) provides the fluent API for:
 * - Event handlers: $.on.Customer.signup(handler)
 * - Scheduling: $.every.Monday.at('9am')(handler)
 * - Cross-DO RPC: $.Customer(id).method()
 * - Durability levels: $.send(), $.try(), $.do()
 */
export type { WorkflowContext, $ } from './context'
/**
 * EntityManager provides wrapped access to Things, Events, and Relationships stores
 * with automatic event emission and audit logging on entity changes.
 *
 * @see {@link ThingsStore} for entity CRUD operations
 * @see {@link EventsStore} for event emission and querying
 * @see {@link RelationshipsStore} for entity relationships
 */
export { EntityManager, withEntities, type EntityManagerOptions } from './entities'

/**
 * Type-safe WorkflowContext types for compile-time type checking.
 *
 * Use these types to get full type inference for:
 * - Cross-DO RPC calls with typed return values
 * - Event handlers with typed event payloads
 * - DO binding accessors with proper method signatures
 *
 * @example
 * ```typescript
 * interface DOBindings {
 *   Customer: CustomerDO
 *   Order: OrderDO
 * }
 *
 * interface EventSchemas {
 *   'Customer.signup': { email: string; plan: string }
 * }
 *
 * const $ = createTypedContext<DOBindings, EventSchemas>(state, env)
 * ```
 */
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
  // Note: EventPayload type is exported from ./workflow for actual payload structure
  EventPayload as TypedEventPayload,  // Renamed to avoid conflict
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

/**
 * Type-safe DO binding registry for accessing DurableObjectNamespace bindings.
 *
 * Provides utilities for:
 * - Type-safe binding access from environment
 * - Stub creation with proper typing
 * - Runtime detection of DO namespace bindings
 */
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

/**
 * Audit logging types for tracking entity changes and user actions.
 * Re-exported from @dotdo/db for convenience.
 */
export type {
  AuditLog,
  AuditLogStore,
  AuditLogQueryOptions,
  AuditLogConfig,
  AuditContext,
  AuditLogLevel,
  AuditAction
} from '@dotdo/db'

/**
 * WebSocket management for real-time communication in Durable Objects.
 *
 * Provides:
 * - Connection handling and upgrade
 * - Message routing to handlers
 * - Broadcast to tagged connections
 * - Heartbeat/ping-pong support
 * - Reconnection tracking
 */
export {
  WebSocketManager,
  type WebSocketMessage,
  type WebSocketHandler,
  type BroadcastResult,
  type ConnectionMetadata,
  type ConnectionHandler
} from './websocket'

/**
 * Workflow module utilities for cross-DO RPC and scheduling.
 *
 * Cross-DO RPC: Call methods on other Durable Objects via $.Customer(id).method()
 * Scheduling: Register handlers for recurring execution via $.every DSL
 */
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

/**
 * EventSystem - Standalone event handling with typed events and listeners.
 * Decoupled from WorkflowContext for use in other contexts.
 */
export {
  EventSystem,
  createEventSystem,
  type EventPayload,
  type EventEmitListener,
  type EventSystemOptions,
} from './workflow'

/**
 * Event handler system for $.on.Noun.verb pattern.
 *
 * Register handlers that respond to events matching Noun.verb patterns.
 * Supports wildcards: $.on.Customer['*'] for all Customer events.
 *
 * @example
 * ```typescript
 * $.on.Customer.signup(async (event) => {
 *   console.log('Customer signed up:', event.payload)
 * })
 * ```
 */
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

/**
 * Scheduling DSL for recurring task execution.
 *
 * Register handlers that run on schedules using fluent API:
 * - $.every.Monday.at('9am')(handler)
 * - $.every.day.at('6pm')(handler)
 * - $.every.hour(handler)
 * - $.every(5).minutes(handler)
 *
 * @example
 * ```typescript
 * $.every.Monday.at('9am')(async () => {
 *   await generateWeeklyReport()
 * })
 * ```
 */
export {
  createEveryProxy,
  type ScheduleHandler,
  type ScheduleInterval,
  type ScheduleRegistration
} from './schedule'

/**
 * Fire-and-forget error tracking for $.send() operations.
 *
 * Tracks errors from fire-and-forget operations that would otherwise be lost.
 * Supports both in-memory and SQLite-backed stores for persistence.
 */
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

/**
 * Admin interface for DO inspection and management.
 *
 * Provides hooks for listing entities, emitting events, and inspecting state.
 * Useful for debugging and administrative tooling.
 */
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

/**
 * DO-level authentication guards for securing Durable Object access.
 *
 * Provides:
 * - Caller type detection (Worker, DO, User, Internal)
 * - HMAC signature verification for DO-to-DO calls
 * - Hono middleware for request authentication
 * - Specialized guards for different caller types
 *
 * @example
 * ```typescript
 * const guard = createDOAuthGuard({ secret: env.DO_INTERNAL_SECRET })
 * const caller = await guard.validateRequest(request)
 * ```
 */
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

/**
 * Third-party integration registry for connecting external services.
 *
 * Manage integrations with services like Stripe, SendGrid, etc.
 * Supports webhook handling and connection state management.
 */
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
} from '@dotdo/integrations'

/**
 * Stripe integration for payment processing.
 */
export {
  StripeIntegration,
  createStripeIntegration,
  type StripeConfig,
  type StripeCustomer,
  type StripePaymentIntent,
  type StripeSubscription,
  type StripeMethods,
} from '@dotdo/integrations/stripe'

/**
 * SendGrid integration for email delivery.
 */
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
} from '@dotdo/integrations/sendgrid'

/**
 * Extended primitives for file system, git, and bash operations.
 *
 * Note: Primitives are exported from their respective packages:
 * - @dotdo/fsx: File system operations
 * - gitx: Git operations (separate package)
 * - bashx: Bash execution (separate package)
 *
 * These are intentionally excluded from the main do/ package to keep
 * the core DO functionality separate from extended tooling.
 */
// Primitives exports are commented out - import directly from fsx/gitx/bashx packages
// export { ... } from './primitives'

/**
 * DO sharding support for horizontal scaling.
 *
 * Distributes requests across multiple DO instances based on shard keys.
 * Supports consistent hashing and configurable shard counts.
 *
 * @example
 * ```typescript
 * const router = createShardRouter({ shardCount: 16 })
 * const shardId = router.getShardId(userId)
 * ```
 */
export {
  ShardRouter,
  createShardRouter,
  fnv1aHash,
  getShardIndex,
  shardMiddleware,
  extractUserIdFromHeader,
  extractShardFromQuery,
  type ShardKeyConfig,
  type ShardContext,
  type ShardResult,
  type ShardRouterConfig,
} from './shard'
