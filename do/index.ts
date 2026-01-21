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
  // Hibernating WebSocket mixin (includes reconnection protocol)
  WithHibernatingWebSocket,
  type HasHibernatingWebSocket,
  type WithHibernatingWebSocketOptions,
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
 * Dead Letter Queue (DLQ) types for monitoring failed event processing.
 * Re-exported from @dotdo/db for convenience.
 *
 * Use EventsStore.getDLQStats() to monitor DLQ health:
 * - Total failed events
 * - Breakdown by event type and error type
 * - Age of entries (oldest/newest timestamps)
 * - Average retry attempts before failure
 */
export type {
  DLQEntry,
  DLQStats,
  DLQQueryOptions,
  DurabilityConfig,
  EventRetryStatus,
  RetryMetrics,
  ValidationFailure
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
 * WebSocket Hibernation support with reconnection protocol.
 *
 * Provides:
 * - Hibernation-aware WebSocket connection management
 * - Session state preservation across hibernation
 * - Reconnection handshake protocol for session resumption
 * - Event buffering and replay for missed events
 * - Exponential backoff configuration for client retries
 * - Cost savings through DO hibernation during idle periods
 *
 * @example
 * ```typescript
 * class MyDO extends DO {
 *   private hibernationManager: HibernationManager
 *
 *   constructor(state: DurableObjectState, env: DOEnv) {
 *     super(state, env)
 *     this.hibernationManager = new HibernationManager(state, {}, {
 *       maxEventBuffer: 1000,
 *       sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
 *     })
 *
 *     state.blockConcurrencyWhile(async () => {
 *       await this.hibernationManager.restoreFromHibernation()
 *     })
 *   }
 *
 *   async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
 *     // Handle reconnection protocol messages automatically
 *     const handled = await this.hibernationManager.handleProtocolMessage(ws, message)
 *     if (handled) return
 *     // Process regular messages...
 *   }
 *
 *   emitEvent(type: string, payload: unknown) {
 *     this.hibernationManager.broadcastEvent(type, payload)
 *   }
 * }
 * ```
 */
export {
  // HibernationManager - main class for hibernation support
  HibernationManager,
  type HibernationAttachment,
  type HibernationState,
  type HibernationConfig,
  DEFAULT_HIBERNATION_CONFIG,
  // Cost estimation utilities
  estimateHibernationSavings,
  // Error detection
  isHibernationError,
  // Payload utilities
  createHibernationPayload,
} from './hibernation'

/**
 * WebSocket Reconnection Protocol for session resumption.
 *
 * Implements a robust reconnection protocol for WebSocket connections
 * that survive Durable Object hibernation:
 *
 * 1. **Session Management**: Create and validate sessions across connections
 * 2. **Event Buffering**: Buffer events for replay on reconnection
 * 3. **Protocol Messages**: Standardized handshake messages
 * 4. **Backoff Strategy**: Exponential backoff for client retries
 *
 * ## Protocol Flow
 *
 * 1. Server sends `session.init` with sessionId and sequence on connect
 * 2. Client stores sessionId and tracks lastSeq from received messages
 * 3. On disconnect, client reconnects with `session.resume` message
 * 4. Server validates and replays events since lastSeq
 * 5. If session expired, server sends `session.expired` with fresh session
 *
 * @example
 * ```typescript
 * // Server-side (in DO)
 * const manager = new SessionManager(ctx)
 * const session = manager.createSession(ws)
 * ws.send(JSON.stringify(manager.createInitMessage(session)))
 *
 * // On reconnection
 * const result = await manager.resumeSession(ws, resumeMessage)
 * if (result.success) {
 *   for (const event of result.missedEvents) {
 *     ws.send(JSON.stringify(event))
 *   }
 * }
 *
 * // Client-side
 * const state = createClientState('my-client-id')
 * // After receiving session.init
 * const newState = handleSessionInit(state, message)
 * // After receiving event
 * const updatedState = handleEvent(state, eventMessage)
 * // On disconnect
 * const disconnectedState = handleDisconnect(state)
 * // Reconnect with resume message
 * const resumeMsg = createResumeMessage(disconnectedState)
 * ```
 */
export {
  // SessionManager - server-side session management
  SessionManager,
  type SessionState,
  type BufferedEvent,
  type ReconnectionConfig,
  DEFAULT_RECONNECTION_CONFIG,
  // Protocol version and constants
  RECONNECTION_PROTOCOL_VERSION,
  DEFAULT_SESSION_TIMEOUT_MS,
  DEFAULT_MAX_EVENT_BUFFER,
  // Protocol message types
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
  // Error codes
  type SessionErrorCode,
  // Backoff configuration
  type BackoffConfig,
  DEFAULT_BACKOFF_CONFIG,
  calculateBackoffDelay,
  shouldRetry,
  // Client-side helpers
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
  // Message parsing
  parseProtocolMessage,
  isProtocolMessage,
} from './websocket-reconnection'

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
  // DO-level RBAC
  doRbacMiddleware,
  requireDOPermission,
  requireDORoleLevel,
  requireDORole,
  checkDOAuthorization,
  type DORBACMiddlewareOptions,
  // Re-exported RBAC types from @dotdo/auth
  PolicyEngine,
  ROLE_HIERARCHY,
  userHasAtLeastRole,
  type UserContext,
  type ResourceContext,
  type PolicyDecision,
  type RoleDefinition,
  type PermissionAction,
  type ResourceType,
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
  createIntegrationRegistry,
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
 * Extended Primitives - FSX, GitX, BashX, NpmX
 *
 * Primitives are optional capabilities that can be wired into the WorkflowContext ($).
 * Each primitive is a separate package that implements a capability interface.
 *
 * ## Naming Conventions
 * - **FSX** (File System eXtended) - POSIX filesystem from `fsx.do`
 * - **GitX** (Git eXtended) - Git operations from `gitx.do`
 * - **BashX** (Bash eXtended) - Shell execution from `bashx.do`
 * - **NpmX** (NPM eXtended) - Package management from `npmx.do`
 *
 * ## Capability Interfaces
 *
 * The capability interfaces (FsCapability, GitCapability, BashCapability) define
 * the contract that primitive implementations must satisfy:
 *
 * @example
 * ```typescript
 * import { createContext, type FsCapability, type GitCapability } from '@dotdo/do'
 * import { FsModule } from 'fsx.do'
 * import { GitModule } from 'gitx.do'
 *
 * const fs: FsCapability = new FsModule(state)
 * const git: GitCapability = new GitModule(state)
 *
 * const $ = createContext(state, env, { fs, git })
 *
 * // Use primitives via $
 * await $.fs.writeFile('/config.json', JSON.stringify(config))
 * await $.git.commit('Update config')
 * ```
 *
 * @see {@link FsCapability} for filesystem operations
 * @see {@link GitCapability} for git operations
 * @see {@link BashCapability} for shell execution
 */
export {
  // Primitive registry and utilities
  PRIMITIVES,
  getPrimitiveInfo,
  listPrimitives,
  // Type definitions for primitive metadata
  type FSX,
  type GitX,
  type BashX,
  type NpmX,
  type PrimitiveRegistry,
  type PrimitiveName,
} from './primitives'

/**
 * Capability interfaces for primitives.
 *
 * These interfaces define the contract that primitive implementations must satisfy.
 * Import these when you need to type-check primitive implementations.
 */
export type {
  FsCapability,
  GitCapability,
  BashCapability,
} from './workflow/context'

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
  // Basic sharding
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
  // Load balancing
  LoadMetricsStore,
  LoadBalancedRouter,
  createLoadBalancedRouter,
  type LoadMetricsStoreConfig,
  type LeastLoadedResult,
  type LoadBalanceTelemetryEvent,
  type LoadBalancedShardResult,
  type LoadBalancedRouterConfig,
  // Health monitoring (do-8x8l)
  ShardHealthMonitor,
  createShardHealthMonitor,
  type ShardHealthStatus,
  type ShardHealthMetrics,
  type ShardHealthConfig,
  // Dynamic rebalancing (do-8x8l)
  ShardRebalancer,
  createShardRebalancer,
  type RebalanceAction,
  type RebalanceDecision,
  type ShardRebalancerConfig,
  type ShardRegistryEntry,
  type MigrationTask,
  // Health-aware routing (do-8x8l)
  HealthAwareRouter,
  createHealthAwareRouter,
  type HealthAwareRouterConfig,
} from './shard'
