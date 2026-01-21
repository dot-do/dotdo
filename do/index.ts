/**
 * @dotdo/do - THE Durable Object for Digital Objects
 *
 * DO = Durable Object = Digital Object
 *
 * This module provides the core DO class that serves as the foundation for building
 * Durable Objects with built-in entity storage, event handling, WebSocket support,
 * and scheduling capabilities.
 *
 * @module @dotdo/do
 *
 * @example
 * ```typescript
 * import { DO, createContext, type WorkflowContext } from '@dotdo/do'
 *
 * // Extend DO for custom behavior
 * class MyDO extends DO {
 *   protected routes(app: Hono): void {
 *     app.get('/custom', (c) => c.json({ custom: true }))
 *   }
 * }
 *
 * // Use WorkflowContext for event handling and scheduling
 * const $ = createContext(state, env)
 * $.on.Customer.signup((event) => {
 *   console.log('New customer:', event.payload)
 * })
 * ```
 */

/**
 * The base DO class - THE Durable Object for Digital Objects.
 *
 * Uses composition over inheritance by delegating to specialized handlers:
 * - StorageHandler: Entity management (things, events, relationships)
 * - RPCHandler: RPC endpoint handling (/rpc)
 * - WebSocketHandler: WebSocket connection management
 *
 * @stable
 * @since 1.0.0
 */
export { DO, type DOEnv, type DOOptions, type DOMetricsConfig } from './DO'

/**
 * BusinessDO - Durable Object for Business-as-Code
 *
 * Extends DO with analytics, finance, experiments, OKRs, and typed
 * collections for Products and Services.
 *
 * @example
 * ```typescript
 * import { BusinessDO } from '@dotdo/do'
 *
 * class MyBusinessDO extends BusinessDO {
 *   constructor(state: DurableObjectState, env: Env) {
 *     super(state, env, {
 *       analytics: { enabled: true },
 *       finance: { stripeApiKey: env.STRIPE_SECRET_KEY }
 *     })
 *   }
 * }
 *
 * // Usage
 * const mrr = await business.getMRR()
 * const health = await business.okrs.health()
 * ```
 *
 * @stable
 * @since 1.1.0
 */
export {
  BusinessDO,
  type BusinessDOConfig,
  type BusinessAnalyticsConfig,
  type BusinessFinanceConfig,
  type OKRConfig,
  type Product,
  type ProductPrice,
  type Service,
  type OKR,
  type KeyResult,
  type ProductAnalyticsResult,
  type ServiceAnalyticsResult,
  type OKRHealth,
  type ProductsCollection,
  type ServicesCollection,
  type OKRsCollection,
} from './BusinessDO'

/**
 * TypeScript type generation utilities.
 *
 * Generates TypeScript .d.ts definitions for DO interfaces dynamically.
 * Used by SDK/CLI auto-generation tools.
 *
 * @example
 * ```typescript
 * import { generateTypes } from '@dotdo/do'
 *
 * const result = generateTypes({ includeComments: true })
 * console.log(result.types) // TypeScript definitions
 * ```
 */
export {
  generateTypes,
  clearTypeCache,
  type TypeGenOptions,
  type TypeGenResult,
  type CustomTypeDefinition,
  type FieldDefinition,
} from './types-gen'

/**
 * Composable mixins for building custom DOs with specific capabilities.
 *
 * Use mixins to add storage, WebSocket, RPC, or auth capabilities
 * to your Durable Object classes.
 *
 * @example
 * ```typescript
 * import { WithStorage, WithWebSocket } from '@dotdo/do'
 *
 * class MyDO extends WithWebSocket(WithStorage(DurableObject)) {
 *   // Has both storage and WebSocket capabilities
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
 * The WorkflowContext provides a fluent DSL for:
 * - Event handlers: $.on.Noun.verb(handler)
 * - Scheduling: $.every.Monday.at('9am')(handler)
 * - Cross-DO RPC: $.Customer(id).method()
 *
 * @param state - The DurableObjectState
 * @param env - The environment containing DO namespace bindings
 * @param options - Optional configuration
 * @returns A WorkflowContext instance
 *
 * @example
 * ```typescript
 * const $ = createContext(state, env)
 *
 * // Event handling
 * $.on.Customer.signup((event) => {
 *   console.log('New signup:', event.payload.email)
 * })
 *
 * // Scheduling
 * $.every.day.at('6pm')(() => sendDailySummary())
 *
 * // Cross-DO RPC
 * const profile = await $.Customer('user-123').getProfile()
 * ```
 */
export { createContext, createTypedContext } from './context'
export type { WorkflowContext, $ } from './context'
// Primitive capability types (do-ibsi)
export type {
  FsCapability,
  GitCapability,
  BashCapability,
  NpmCapability,
  PrimitivesConfig,
  CreateContextOptions,
} from './workflow'
/**
 * Entity management for DOs with built-in CRUD operations.
 *
 * @example
 * ```typescript
 * import { EntityManager } from '@dotdo/do'
 *
 * const entities = new EntityManager(storage)
 * await entities.create('Customer', { name: 'Alice', email: 'alice@example.com' })
 * ```
 */
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

/**
 * Type-safe DO binding registry for cross-DO communication.
 *
 * Provides type-safe access to DO namespace bindings with automatic
 * stub creation and ID management.
 *
 * @example
 * ```typescript
 * import { getBinding, getStub, createBindingAccessor } from '@dotdo/do'
 *
 * // Get a DO namespace binding
 * const customerNs = getBinding(env, 'CUSTOMER')
 *
 * // Get a typed stub for a specific ID
 * const customerStub = getStub<CustomerDO>(env.CUSTOMER, 'user-123')
 *
 * // Create a reusable binding accessor
 * const accessor = createBindingAccessor(env, 'CUSTOMER')
 * const stub = accessor.get('user-123')
 * ```
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

// NOTE: AuditLog types belong to @dotdo/db, import from there directly:
// import type { AuditLog, AuditLogStore, AuditContext, ... } from '@dotdo/db'

/**
 * Workflow utilities for cross-DO RPC, scheduling, and event handling.
 *
 * Provides low-level utilities for building advanced workflow patterns
 * including cross-DO communication, stub caching, and schedule management.
 *
 * @example
 * ```typescript
 * import { createDOAccessor, createDORPCProxy } from '@dotdo/do'
 *
 * // Create a DO accessor for type-safe RPC
 * const accessor = createDOAccessor(env, 'CUSTOMER')
 * const customerProxy = accessor('user-123')
 * const profile = await customerProxy.getProfile()
 *
 * // Manage schedules programmatically
 * import { getSchedules, executeSchedule } from '@dotdo/do'
 * const schedules = getSchedules()
 * await executeSchedule('daily-report')
 * ```
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
  // Entity accessor types (do-lekf.2)
  type EntitySchema,
  type EntityListOptions,
  type EntityInstance,
  type EntityAccessor,
  type EntityProxy,
  type EntityProxyConfig,
  // Typed entity accessor types with type narrowing (do-b1tuz)
  type TypedEntityInstance,
  type TypedEntityAccessor,
  type TypedEntityProxy,
  type EntityDefinitionsConstraint,
  type EmptyEntityDefinitions,
  type DefineEntities,
  type EntitySchemaDefinition,
  type EntityAccessors,
  type TypedWorkflowContextWithEntities,
  type CreateTypedEntityContext,
} from './workflow'

/**
 * Event handler system ($.on.Noun.verb) for declarative event routing.
 *
 * Enables Noun.verb style event handlers with automatic pattern matching.
 *
 * @example
 * ```typescript
 * import { createOnProxy, invokeHandlers } from '@dotdo/do'
 *
 * const on = createOnProxy()
 * on.Customer.signup((event) => {
 *   console.log('Customer signed up:', event.payload)
 * })
 *
 * // Invoke matching handlers
 * await invokeHandlers('Customer.signup', { email: 'test@example.com' })
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
 * Scheduling DSL ($.every.Monday.at('9am')) for declarative scheduling.
 *
 * Provides a fluent interface for registering recurring tasks with
 * cron-like semantics.
 *
 * @example
 * ```typescript
 * import { createEveryProxy } from '@dotdo/do'
 *
 * const every = createEveryProxy()
 * every.Monday.at('9am')(() => generateWeeklyReport())
 * every.hour(() => checkForUpdates())
 * every.day.at('6pm')(() => sendDailySummary())
 * ```
 */
export {
  createEveryProxy,
  type ScheduleHandler,
  type ScheduleInterval,
  type ScheduleRegistration
} from './schedule'

/**
 * Fire-and-forget error tracking for async operations.
 *
 * Captures and stores errors from fire-and-forget operations
 * for later inspection and debugging.
 *
 * @example
 * ```typescript
 * import { trackFireAndForget, createSQLiteErrorStore } from '@dotdo/do'
 *
 * const errorStore = createSQLiteErrorStore(storage)
 * trackFireAndForget(asyncOperation(), errorStore)
 *
 * // Later: inspect errors
 * const errors = await errorStore.list({ limit: 10 })
 * ```
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
 * WebSocket management for real-time communication.
 *
 * Provides WebSocket connection management with automatic tracking,
 * broadcasting, and connection lifecycle handling.
 *
 * @example
 * ```typescript
 * import { WebSocketManager } from '@dotdo/do'
 *
 * const wsManager = new WebSocketManager()
 *
 * // Accept a WebSocket connection
 * wsManager.accept(websocket, { userId: 'user-123' })
 *
 * // Broadcast to all connected clients
 * wsManager.broadcast({ type: 'update', data: { ... } })
 * ```
 */
export {
  WebSocketManager,
  // Message size limits (do-nyah)
  MAX_WEBSOCKET_MESSAGE_SIZE,
  WEBSOCKET_CLOSE_CODES,
  type WebSocketMessage,
  type WebSocketHandler,
  type BroadcastResult,
  type ConnectionMetadata,
  type ConnectionHandler
} from './websocket'

/**
 * WebSocket Event Streaming for remote $ context subscriptions (do-9zknf).
 *
 * Provides server-side support for WebSocket event subscriptions and streaming.
 * Clients can subscribe to event patterns (e.g., 'Customer.signup', 'Order.*')
 * and receive events pushed in real-time when they fire.
 *
 * @example
 * ```typescript
 * import { WebSocketEventStreaming, createWebSocketEventStreaming } from '@dotdo/do'
 *
 * // Server side: events are automatically pushed to subscribers
 * const streaming = createWebSocketEventStreaming(wsManager, eventsStore)
 *
 * // In webSocketMessage handler:
 * if (streaming.handleMessage(ws, message)) {
 *   // Message was a subscription message, handled automatically
 *   return
 * }
 *
 * // Client sends: { type: 'subscribe', event: 'Customer.signup', subscriptionId: 'sub-123' }
 * // Client receives: { type: 'subscribed', subscriptionId: 'sub-123', event: 'Customer.signup' }
 * // When event fires, client receives: { type: 'event', event: 'Customer.signup', payload: {...}, $id: '...', $timestamp: ... }
 * ```
 */
export {
  WebSocketEventStreaming,
  createWebSocketEventStreaming,
  isEventSubscriptionMessage,
  type EventSubscriptionMessage,
  type EventPushMessage,
  type SubscriptionAckMessage,
} from './websocket-streaming'

/**
 * WebSocket hibernation for resource-efficient long-lived connections.
 *
 * Uses Cloudflare's WebSocket hibernation feature to reduce costs
 * when connections are idle.
 *
 * @example
 * ```typescript
 * import { HibernationManager, estimateHibernationSavings } from '@dotdo/do'
 *
 * const hibernation = new HibernationManager(ctx)
 * hibernation.accept(websocket, { roomId: 'room-123' })
 *
 * // Estimate cost savings
 * const savings = estimateHibernationSavings(1000) // 1000 connections
 * ```
 */
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

/**
 * WebSocket reconnection protocol for reliable real-time communication.
 *
 * Implements a session-based reconnection protocol that preserves state
 * across disconnections, with event buffering and automatic recovery.
 *
 * @example
 * ```typescript
 * import { SessionManager, createClientState, handleDisconnect } from '@dotdo/do'
 *
 * // Server side
 * const sessions = new SessionManager()
 * const sessionId = sessions.create(websocket)
 *
 * // Client side (reconnection)
 * const clientState = createClientState()
 * const shouldResume = shouldAttemptResume(clientState)
 * if (shouldResume) {
 *   const resumeMsg = createResumeMessage(clientState.sessionId, clientState.lastEventId)
 *   websocket.send(JSON.stringify(resumeMsg))
 * }
 * ```
 */
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

/**
 * Admin interface hooks for DO state inspection and management.
 *
 * Provides administrative access to DO internals for debugging,
 * monitoring, and operational tasks.
 *
 * @example
 * ```typescript
 * import { AdminDO, createAdminHooks } from '@dotdo/do'
 *
 * const admin = createAdminHooks(storage)
 * const health = await admin.getHealth()
 * const state = await admin.inspectState()
 * const entities = await admin.listEntities({ type: 'Customer', limit: 50 })
 * ```
 */
export {
  AdminDO,
  createAdminHooks,
  type AdminStores,
  type EntityListOptions as AdminEntityListOptions,
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
 * DO-level authentication guards for secure access control.
 *
 * Provides authentication and authorization for DO method calls,
 * including caller detection, HMAC signing for DO-to-DO calls,
 * and role-based access control.
 *
 * Security: Use extractCallerInfoWithVerification (not extractCallerInfo)
 * to properly verify DO-to-DO signatures and prevent header spoofing.
 *
 * @example
 * ```typescript
 * import { createDOAuthGuard, requireWorkerCaller, doAuthMiddleware } from '@dotdo/do'
 *
 * // Create an auth guard
 * const guard = createDOAuthGuard({
 *   requireAuth: true,
 *   allowedCallers: ['worker', 'do']
 * })
 *
 * // Use as Hono middleware
 * app.use('/admin/*', doAuthMiddleware({ requireWorkerCaller: true }))
 *
 * // Manually check caller type
 * const callerInfo = await extractCallerInfoWithVerification(request)
 * if (callerInfo.type !== 'worker') throw new Error('Unauthorized')
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
 * Third-party integration registry for managing external service connections.
 *
 * Provides a unified interface for registering, configuring, and using
 * integrations with third-party services like Stripe, SendGrid, etc.
 *
 * NOTE: These are convenience re-exports from @dotdo/integrations.
 * Users can also import directly: `import { ... } from '@dotdo/integrations'`
 *
 * Design decision (do-clsc0): Re-exporting integrations from @dotdo/do is intentional:
 * - Provides single-package DX for common use cases
 * - Modern bundlers tree-shake unused exports (no bundle size impact)
 * - TypeScript only includes types that are actually used
 * - Users who want minimal dependencies can import from @dotdo/integrations directly
 *
 * @example
 * ```typescript
 * import { IntegrationRegistry, registerIntegration, getIntegration } from '@dotdo/do'
 *
 * // Register an integration
 * registerIntegration('stripe', { apiKey: process.env.STRIPE_KEY })
 *
 * // Use the integration
 * const stripe = getIntegration('stripe')
 * const customer = await stripe.createCustomer({ email: 'user@example.com' })
 * ```
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
 *
 * @example
 * ```typescript
 * import { createStripeIntegration } from '@dotdo/do'
 *
 * const stripe = createStripeIntegration({ apiKey: process.env.STRIPE_KEY })
 * const customer = await stripe.createCustomer({ email: 'user@example.com' })
 * const payment = await stripe.createPaymentIntent({ amount: 1000, currency: 'usd' })
 * ```
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
 *
 * @example
 * ```typescript
 * import { createSendGridIntegration } from '@dotdo/do'
 *
 * const sendgrid = createSendGridIntegration({ apiKey: process.env.SENDGRID_KEY })
 * await sendgrid.sendEmail({
 *   to: 'user@example.com',
 *   subject: 'Welcome!',
 *   html: '<h1>Welcome to our service</h1>'
 * })
 * ```
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

// NOTE: Extended primitives (fsx, gitx, bashx) are in v1 worktree only
// See .worktrees/v1/do/capabilities/ for reference implementations
// These will be reimplemented in v3 when needed

/**
 * Circuit Breaker pattern implementation for protecting against cascading failures.
 *
 * Recommended usage with request-scoped isolation:
 * ```ts
 * await runWithCircuitBreakerRegistry(async () => {
 *   const circuit = getCircuitBreaker('my-service')
 *   await circuit.execute(() => fetchData())
 * })
 * ```
 */
export {
  CircuitBreaker,
  CircuitBreakerRegistry,
  createCircuitBreaker,
  createCircuitBreakerRegistry,
  // Request-scoped (recommended)
  runWithCircuitBreakerRegistry,
  getCurrentCircuitBreakerRegistry,
  getCircuitBreaker,
  // Deprecated global registry (for backward compatibility only)
  /** @deprecated Use runWithCircuitBreakerRegistry() instead */
  getGlobalCircuitBreakerRegistry,
  /** @deprecated Use runWithCircuitBreakerRegistry() instead */
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

/**
 * Shared proxy utilities for building Proxy-based APIs.
 *
 * These utilities are used across @dotdo/do, @dotdo/rpc, and rpc.do packages
 * for consistent proxy behavior including:
 * - Two-level nested proxies for $.on.Noun.verb() patterns
 * - Method proxies for RPC-style calls
 * - Deep nested RPC proxies for client.users.create() patterns
 * - Event handler proxies for $.on.Entity.action() patterns
 * - Schedule DSL proxies for $.every.Monday.at('9am') patterns
 * - Entity access proxies for $.Customer('id').method() patterns
 *
 * @example
 * ```typescript
 * import { createDeepRPCProxy, createEventProxy, PROMISE_PROPS } from '@dotdo/do'
 *
 * // Create an RPC client proxy
 * const client = createDeepRPCProxy({
 *   invoke: async (path, args) => {
 *     return fetch('/rpc', {
 *       method: 'POST',
 *       body: JSON.stringify({ method: path.join('.'), args })
 *     }).then(r => r.json())
 *   }
 * })
 *
 * // Use the client
 * await client.users.create({ name: 'Alice' })
 * ```
 */
export {
  PROMISE_PROPS,
  createNestedProxy,
  createMethodProxy,
  createCallableNestedProxy,
  createDeepRPCProxy,
  createEventProxy,
  createScheduleProxy,
  createEntityAccessProxy,
  type DeepRPCProxyOptions,
  type EventProxyOptions,
  type ScheduleProxyOptions,
  type EntityProxyOptions,
} from '@dotdo/utils'

/**
 * Saga Pattern for Cross-DO Transaction Coordination (do-o9ix8).
 *
 * Implements the Saga pattern for managing distributed transactions across
 * multiple Durable Objects. Each saga consists of a sequence of steps,
 * where each step has an execute action and a compensating action.
 *
 * If any step fails, all previously completed steps are compensated
 * (rolled back) in reverse order.
 *
 * @example
 * ```typescript
 * import { createSaga, executeSaga } from '@dotdo/do'
 *
 * const orderSaga = createSaga<OrderContext>({
 *   name: 'create-order',
 *   steps: [
 *     {
 *       name: 'reserve-inventory',
 *       execute: async (ctx) => {
 *         await $.Inventory(ctx.productId).reserve(ctx.quantity)
 *         return { ...ctx, inventoryReserved: true }
 *       },
 *       compensate: async (ctx) => {
 *         await $.Inventory(ctx.productId).release(ctx.quantity)
 *       },
 *     },
 *     {
 *       name: 'charge-payment',
 *       execute: async (ctx) => {
 *         await $.Payment(ctx.customerId).charge(ctx.amount)
 *         return { ...ctx, paymentCharged: true }
 *       },
 *       compensate: async (ctx) => {
 *         await $.Payment(ctx.customerId).refund(ctx.amount)
 *       },
 *     },
 *   ],
 * })
 *
 * const result = await executeSaga(orderSaga, {
 *   productId: 'p-1',
 *   quantity: 5,
 *   customerId: 'cust-123',
 *   amount: 100,
 * })
 *
 * if (result.status === 'completed') {
 *   console.log('Order created successfully')
 * } else if (result.status === 'compensated') {
 *   console.log(`Order failed at step: ${result.failedStep}`)
 * }
 * ```
 */
export {
  createSaga,
  executeSaga,
  compensateSaga,
  SagaError,
  isSagaSuccess,
  isSagaCompensated,
  isSagaCompensationFailed,
  type Saga,
  type SagaStep,
  type SagaConfig,
  type SagaResult,
  type SagaState,
  type SagaStatus,
  type CompensationError,
} from './workflow/saga'

/**
 * DO-Level Rate Limiting for external callers (do-soc30).
 *
 * Provides per-DO rate limiting using sliding window or token bucket
 * algorithms. Apply directly within the DO to protect against abuse.
 *
 * @example
 * ```typescript
 * import { DORateLimiter, createTieredRateLimiter, doRateLimitMiddleware } from '@dotdo/do'
 *
 * // Option 1: Manual rate limiting in fetch handler
 * class MyDO extends DO {
 *   private rateLimiter = new DORateLimiter({
 *     defaultLimit: { requestsPerWindow: 100, windowMs: 60000 },
 *   })
 *
 *   async fetch(request: Request): Promise<Response> {
 *     const result = this.rateLimiter.check(request)
 *     if (!result.allowed) {
 *       return this.rateLimiter.createRateLimitResponse(result)
 *     }
 *     return super.fetch(request)
 *   }
 * }
 *
 * // Option 2: Use tiered presets
 * const limiter = createTieredRateLimiter('pro') // 1000 req/min
 *
 * // Option 3: Hono middleware
 * app.use('/*', doRateLimitMiddleware({ keyStrategy: 'ip' }))
 * ```
 */
export {
  DORateLimiter,
  createDORateLimiter,
  createTieredRateLimiter,
  doRateLimitMiddleware,
  type DORateLimitConfig,
  type DORateLimitResult,
  type RateLimitTierConfig,
  type RateLimitHeaders,
} from './rate-limit'
