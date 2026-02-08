// dotdo - Main Package
// Re-exports all @dotdo/* packages for unified consumption
//
// IMPORTANT: Uses explicit named exports to avoid duplicate export conflicts (do-u99x)
// The `export *` statements cause TS2308 errors when packages export the same names.
// See https://github.com/microsoft/TypeScript/issues/4922 for details.

// === @dotdo/do - Durable Objects (canonical for DO-specific types) ===
export { DO, type DOEnv, type DOOptions } from '@dotdo/do'
export { createContext, createTypedContext, type WorkflowContext, type $ } from '@dotdo/do'

// Mixins
export {
  WithStorage,
  type Constructor,
  type HasStorage,
  type WithStorageOptions,
  type MixinInstance,
  WithWebSocket,
  type HasWebSocket,
  type WithWebSocketOptions,
  WithRPC,
  type HasRPC,
  type WithRPCOptions,
  type RPCRequest,
  type RPCResponse,
  WithAuth,
  type HasAuth,
  type WithAuthOptions,
  type ComposedType,
  type InstanceOf,
} from '@dotdo/do'

export { EntityManager, withEntities, type EntityManagerOptions } from '@dotdo/do'

// Type-safe context types
export type {
  TypedWorkflowContext,
  $Typed,
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
  TypedOnProxy,
  TypedNounEventProxy,
  TypedEveryProxy,
  ScheduleRegisterFn,
  TimeAccessor,
  DayOfWeekProxy,
  IntervalUnitProxy,
  WeekProxy,
  EveryProxy,
  BaseWorkflowContext,
  TypedBaseWorkflowContext,
  DoOptions,
  TypedContextConfig,
  CreateTypedContextOptions,
} from '@dotdo/do'

// Binding registry
export {
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
  createBindingAccessor,
  getBinding,
  getStub,
  isDurableObjectNamespace,
  extractDOBindings,
  asBindingRegistry,
} from '@dotdo/do'

// Audit types (directly from db - clear ownership)
export type {
  AuditLog,
  AuditLogStore,
  AuditLogQueryOptions,
  AuditLogConfig,
  AuditContext,
  AuditLogLevel,
  AuditAction,
} from '@dotdo/db'

// Workflow utilities
export {
  createDOAccessor,
  createDORPCProxy,
  hasStub,
  clearStub,
  clearAllStubs,
  getStubCount,
  type CrossDORPCConfig,
  getSchedules,
  getScheduleCount,
  clearSchedules,
  executeSchedule,
  type HandlerResult,
  type InvokeHandlersResult,
} from '@dotdo/do'

// Event handler system
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
  type NounEventProxy,
} from '@dotdo/do'

// Scheduling DSL
export {
  createEveryProxy,
  type ScheduleHandler,
  type ScheduleInterval,
  type ScheduleRegistration,
} from '@dotdo/do'

// Fire-and-forget error tracking
export {
  createInMemoryErrorStore,
  createSQLiteErrorStore,
  extractErrorInfo,
  trackFireAndForget,
  type FireAndForgetError,
  type FireAndForgetErrorStore,
  type ErrorQueryOptions,
  type ErrorStats,
} from '@dotdo/do'

// WebSocket management
export {
  WebSocketManager,
  DEFAULT_BACKPRESSURE_THRESHOLD,
  type WebSocketMessage,
  type WebSocketHandler,
  type BroadcastResult,
  type ConnectionMetadata,
  type ConnectionHandler,
  type BackpressureConfig,
  type ConnectionRateLimitConfig,
} from '@dotdo/do'

// WebSocket hibernation
export {
  HibernationManager,
  type HibernationAttachment,
  type HibernationState,
  type HibernationConfig,
  DEFAULT_HIBERNATION_CONFIG,
  estimateHibernationSavings,
  isHibernationError,
  createHibernationPayload,
} from '@dotdo/do'

// WebSocket reconnection
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
} from '@dotdo/do'

// Admin interface
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
  type HealthCheck,
} from '@dotdo/do'

// DO-level authentication guards
export {
  createDOAuthGuard,
  type DOAuthGuard,
  type DOAuthGuardConfig,
  type AuthPayload,
  type CallerInfo,
  type CallerType,
  detectCallerType,
  extractCallerInfo,
  extractCallerInfoWithVerification,
  setDOInternalSecret,
  verifyDOSignature,
  getDOInternalSecret,
  clearDOInternalSecret,
  doAuthMiddleware,
  type DOAuthMiddlewareOptions,
  requireWorkerCaller,
  requireDOCaller,
  requireUserCaller,
  requireInternalCaller,
  requireDOSource,
  CF_WORKER_HEADER,
  WORKER_NAME_HEADER,
  CORRELATION_ID_HEADER,
  INTERNAL_TRUST_HEADER,
  DO_SIGNATURE_HEADER,
  DO_TIMESTAMP_HEADER,
  addDOSourceHeaders,
  addDOSourceHeadersAsync,
  createDOToDoHeaders,
  addWorkerHeaders,
} from '@dotdo/do'

// Third-party integration registry
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
} from '@dotdo/do'

// NOTE: Stripe and SendGrid integrations are planned but not yet implemented.
// When available, they will be exported here. For now, use @dotdo/integrations
// for webhook verification and circuit breaker utilities.

// Circuit Breaker (DO version - canonical)
// Use runWithCircuitBreakerRegistry() for request-scoped isolation (recommended)
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
} from '@dotdo/do'

// Graceful degradation
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
} from '@dotdo/do'

// === @dotdo/db - Database Layer (canonical for core data types) ===
// Core types
export type {
  JsonPrimitive,
  JsonArray,
  JsonValue,
  JsonObject,
  StorableData,
  WhereConditions,
} from '@dotdo/db'

// Things
export type { Thing, ThingsStore, ThingInput, ThingUpdate, BulkUpdateItem, CursorResult, CursorOptions } from '@dotdo/db'
export { createThingsStoreWithAdapter } from '@dotdo/db'

// Relationships
export type { Relationship, RelationshipsStore, RelationshipInput, RelationshipQuery } from '@dotdo/db'
export { createRelationshipsStoreWithAdapter } from '@dotdo/db'

// Events
export type { Event, EventsStore, EventInput, EventQueryOptions } from '@dotdo/db'
export { createEventsStoreWithAdapter } from '@dotdo/db'

// Query builder
export { createQuery, createQueryWithJoins, query, buildWhereClause, buildOrderByClause, buildPaginationClause } from '@dotdo/db'
export type { QueryBuilder, QueryOptions, ThingWithJoins, PaginatedQueryResult, PaginatedExecuteOptions, WhereOperator, WhereCondition, JoinOptions, JoinSpec, JoinTypeValue } from '@dotdo/db'
export { DEFAULT_QUERY_LIMITS, configureQueryLimits, getQueryLimits, JoinType } from '@dotdo/db'

// Storage adapters
export type { StorageAdapter, ListOptions, ListResult } from '@dotdo/db'
export { createTypedStorage, type TypedStorageAdapter } from '@dotdo/db'

// SQLite
export type { SqlStorage, SqlRunResult, SQLiteAdapterOptions, SQLiteThingsStore } from '@dotdo/db'
export { SQLiteAdapter, createSQLiteThingsStore, createSQLiteEventsStore, createSQLiteRelationshipsStore } from '@dotdo/db'

// Migrations
export type { Migration, MigrationResult, MigrationState } from '@dotdo/db'
export { MigrationRunner, createMigration } from '@dotdo/db'

// Audit (db-specific)
export { createAuditLogStore, createSQLiteAuditLogStore } from '@dotdo/db'

// Schema
export { createSchemaRegistry, defineSchema, SchemaValidationError } from '@dotdo/db'
export type { SchemaRegistry, Schema, SchemaDef, FieldDef, ValidationResult, ValidationError as DbSchemaValidationError } from '@dotdo/db'

// Digital objects - Note: These require the primitives submodule to be initialized
// Import directly from '@dotdo/db/digital-objects' if needed
// export { createDigitalObjectsAdapter, validateSchema } from '@dotdo/db'
// export type { DigitalObjectsThingsStore } from '@dotdo/db'

// Branded types
export type { ThingId, RelationshipId, EventId, CorrelationId } from '@dotdo/db'
export { toThingId, toRelationshipId, toEventId, toCorrelationId, isThingId, isRelationshipId, isEventId, isCorrelationId } from '@dotdo/db'

// ID utilities
export { generateId, generateEventId } from '@dotdo/db'

// Errors (db-specific)
export {
  ErrorCode,
  type ErrorCodeType,
  ERROR_CODE_TO_HTTP_STATUS,
  getHttpStatusForCode,
  isRetryableCode,
  type SerializedDotdoError,
  type DotdoErrorOptions,
  DotdoError,
  DatabaseError,
  DbValidationError,
  DbNotFoundError,
  TransactionError,
  NestedTransactionError,
  serializeDotdoError,
  serializeUnknownAsDotdoError,
  registerErrorClass,
  deserializeDotdoError,
  isSerializedDotdoError,
} from '@dotdo/db'

// === @dotdo/ai - AI Routing Layer ===
export {
  ai,
  type Provider,
  type ProviderConfig,
  configureProvider,
  getProvider,
  clearProviders,
  generateText,
  generateObject,
  streamText,
  embedText,
  chat,
  type GenerateTextOptions,
  type GenerateTextResult,
  type GenerateObjectOptions,
  type GenerateObjectResult,
  type StreamTextOptions,
  type StreamTextResult,
  type EmbedTextOptions,
  type ChatMessage,
  type ChatOptions,
  type AIFunctionDefinition,
  type AIFunctionCall,
  type AIGenerateOptions,
  type AIGenerateResult,
  createTool,
  type Tool,
  type ToolDefinition,
  type JSONSchema as AIJSONSchema,
  type SimpleSchema,
} from '@dotdo/ai'

export {
  countMessageTokens,
  getModelPricing,
  preloadEncoders,
  clearEncoderCache,
  type ModelPricing,
  type Tiktoken,
} from '@dotdo/ai'

// === @dotdo/auth - Authentication ===
export {
  authMiddleware,
  apiKeyMiddleware,
  type AuthOptions,
  type AuthUser,
  type ApiKeyMiddlewareOptions,
  requireAuth,
  requireRole,
  requireScope,
  requireOwner,
  requireAll,
  requireAny,
  requireRoleLevel,
  requireSuperAdmin,
  requireAdmin,
  requireEditor,
  type GetResourceOwnerIdFn,
  ROLE_HIERARCHY,
  isRoleAtLeast,
  userHasAtLeastRole,
  extractToken,
  verifyTokenSignature,
  checkTokenExpiration,
  validateToken,
  type TokenPayload,
  type TokenValidationOptions,
  type TokenExtractionOptions,
  type ExpirationCheckResult,
  type ExpirationCheckOptions,
  fetchJwks,
  createJwksClient,
  verifyTokenWithJwks,
  validateTokenWithJwks,
  createJwksClientFromIssuer,
  type Jwks,
  type JwksClientOptions,
  type JwksVerifyOptions,
  type JwksValidationOptions,
  type JwksClient,
  ApiKeyManager,
  ApiKeyAuth,
  createApiKeyMiddleware,
  type ApiKey,
  type ApiKeyCreateOptions,
  type ApiKeyValidationResult,
  type ApiKeyListOptions,
  type RateLimitWindow,
  createSession,
  getSession,
  invalidateSession,
  refreshSession,
  cleanupExpiredSessions,
  getUserSessions,
  clearAllSessions,
  type Session,
  type SessionMetadata,
  type SessionOptions,
  configureOrgAiClient,
  getOrgAiClientConfig,
  clearOrgAiCache,
  type OrgAiClientConfig,
  type OrgAiAuthOptions,
  createInMemoryRevocationStore,
  createSQLiteRevocationStore,
  createRevocationChecker,
  checkRevocation,
  type TokenRevocation,
  type RevocationQueryOptions,
  type TokenRevocationStore,
  type TokenRevocationChecker,
  type RevocationAwareValidationOptions,
  validateSecretPresent,
  validateSecretLength,
  getRequiredSecret,
  validateSecret,
  isSecretConfigured,
  MissingSecretError,
  SecretLengthError,
  type SecretValue,
  rbacMiddleware,
  PolicyEngine,
  requireResourceOwner,
  requireTenantMatch,
  getHighestRole,
  type RBACMiddlewareOptions,
  type BuiltInRole,
  type PermissionAction,
  type ResourceType,
  type Permission as AuthPermission,
  type PermissionCondition,
  type RoleDefinition,
  type PolicyDecision,
  type ResourceContext,
  type UserContext,
  DEFAULT_ROLES,
} from '@dotdo/auth'

// === @dotdo/rpc - RPC Communication (canonical for RPC types) ===
export {
  createClient,
  createDOStub,
  createSecureDOStub,
  createClientWithTransport,
  createClientWithPipeline,
  createDOStubWithPipeline,
  generateCorrelationId,
  type RPCClientOptions,
  type DOStubOptions,
  type SecureDOStubOptions,
  type TransportClientOptions,
  type PipelineClientOptions,
  type ClientWithPipeline,
  type DOStubWithPipelineOptions,
  type DOStubWithPipeline,
} from '@dotdo/rpc'

export {
  createServer,
  createWorkerFromTarget,
  type RPCServerOptions,
  type RPCServerApp,
  type RPCRequest as RPCServerRequest,
  CORRELATION_ID_HEADER as RPC_CORRELATION_ID_HEADER,
} from '@dotdo/rpc'

export {
  createCrossDOClient,
  CrossDOStubCache,
  CrossDOContext,
  type CrossDORPCOptions,
  type CrossDOContextOptions,
  type DOContext,
  DO_SOURCE_HEADER,
  DO_SOURCE_ID_HEADER,
} from '@dotdo/rpc'

export {
  createBatchMapPromise,
  batchMap,
  type BatchMapOptions,
  type BatchMapPromise,
} from '@dotdo/rpc'

export {
  executeBatchRPC,
  createBatchRPC,
  executeBatchDORPC,
  createBatchDORPC,
  BatchRPCBuilder,
  BatchDORPCBuilder,
  type BatchRPCCall,
  type BatchRPCResult,
  type BatchRPCRequest,
  type BatchRPCResponse,
  type BatchRPCOptions,
} from '@dotdo/rpc'

// RPC Errors (canonical source)
export {
  RPCErrorCode,
  type RPCErrorOptions,
  RPCError,
  NotFoundError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  RateLimitError,
  TimeoutError,
  NetworkError,
  InternalError,
  ServiceUnavailableError,
  CircuitOpenError,
  isRPCError,
  isNotFoundError,
  isValidationError,
  isAuthenticationError,
  isAuthorizationError,
  isCircuitOpenError,
  isRetryableError,
  type SerializedError,
  type SerializeErrorOptions,
  serializeError,
  serializeUnknownError,
  getErrorMessage,
  isSerializedError,
  deserializeError,
  type RetryOptions,
  retryWithBackoff,
  CircuitState as RPCCircuitState,
  type CircuitBreakerOptions as RPCCircuitBreakerOptions,
  type CircuitMetrics,
  CircuitBreaker as RPCCircuitBreaker,
  withTimeout,
  type RetryWithCircuitBreakerOptions,
  type RetryCircuitBreakerMetrics,
  RetryWithCircuitBreaker,
} from '@dotdo/rpc'

export {
  sanitizeValue,
  sanitizeArgs,
  type RPCErrorContext,
  buildErrorContext,
  logRPCError,
  formatErrorContext,
} from '@dotdo/rpc'

export {
  createPipeline,
  withPipeline,
  PipelineBuilder,
  createPipelineClient,
  executePipeline,
  createPipelineHandler,
  withPipelineSupport,
  type PipelineStep,
  type PipelineRequest,
  type PipelineResponse,
  type PipelinePromise,
  type PipelineExecutorOptions,
} from '@dotdo/rpc'

export {
  createTypedClient,
  createTypedClientFromUrl,
  createTypedClientFromBinding,
  batchCalls,
  type TypedClientOptions,
  type TypedClientBindingOptions,
  type ExtractMethodNames,
  type ExtractMethodParams,
  type ExtractMethodReturn,
  type MethodSignature,
  type PartialClient,
  type AssertValidRPCInterface,
  type BatchCallResult,
} from '@dotdo/rpc'

export {
  isValidRPCMethod,
  validateArgs,
  defineMethodSchema,
  createSchemaRegistry as createRPCSchemaRegistry,
  getMethodSchema,
  ArgSchemas,
  type SchemaType,
  type ArgSchema,
  type MethodSchema,
  type MethodSchemaRegistry,
  type ArgValidationError,
} from '@dotdo/rpc'

export {
  RPCRateLimiter,
  rpcRateLimitMiddleware,
  createRPCRateLimiter,
  DEFAULT_RPC_TIERS,
  type RPCRateLimitTier,
  type MethodRateLimit,
  type UserTenantRateLimit,
  type UserTenantExtractor,
  type TierResolver,
  type RPCRateLimitConfig,
  type RPCRateLimitResult,
} from '@dotdo/rpc'

// === @dotdo/mcp - MCP Server ===
export {
  createMCPServer,
  type MCPServerOptions,
  type MCPServer,
  type MCPTool,
  searchTool,
  createSearchTool,
  fetchTool,
  createFetchTool,
  doTool,
  createSandboxTool,
  sandboxToolMetadata,
  createSandbox,
  DEFAULT_RESOURCE_LIMITS,
  DEFAULT_RATE_LIMIT,
  DEFAULT_CONCURRENCY_LIMIT,
  RateLimiter as MCPRateLimiter,
  ConcurrencyLimiter,
  SandboxResourceEnforcer,
  // RECOMMENDED: Use this for multi-tenant isolation (do-5sc9b)
  createScopedResourceEnforcer,
  // DEPRECATED: These throw errors in production (do-5sc9b)
  /** @deprecated Use createScopedResourceEnforcer() instead - global state leaks between tenants */
  getGlobalResourceEnforcer,
  /** @deprecated Use createScopedResourceEnforcer() instead - global state leaks between tenants */
  setGlobalResourceEnforcer,
  type Sandbox,
  type SandboxOptions,
  type SandboxResult,
  type SandboxPermissions,
  type AuditLog as MCPAuditLog,
  type ResourceLimits,
  type ResourceUsage,
  type RateLimitConfig as MCPRateLimitConfig,
  type ConcurrencyLimitConfig,
  ToolRegistry,
  ToolCategory,
  createDefaultRegistry,
  type ToolMetadata,
  createMockContext,
  createMockThingsStore,
  createMockRelationshipsStore,
  createMockEventsStore,
} from '@dotdo/mcp'

// === @dotdo/api - Self-Describing API ===
export {
  createAPI,
  defineResource,
  getResource,
  getAllResources,
  clearRegistry,
  // Request-scoped resource context (do-73qn)
  runWithResourceContext,
  getCurrentResourceContext,
  clearGlobalRegistry,
  type ResourceDefinition,
  type ResourceFields,
  type FieldDef as APIFieldDef,
  type RelationDef,
  type ActionDef,
  type HookDef,
  type ComputedFieldDef,
  type RouteDefinitions,
  generateLinks,
  generateCollectionLinks,
  withLinks,
  withCollectionLinks,
  generateAPIRootLinks,
  generateAPIRoot,
  generateErrorLinks,
  type Link,
  type HATEOASResponse,
  type ResourceConfig,
  type APIRootConfig,
  generateOpenAPI,
  OpenAPIGenerator,
  specToYAML,
  createSwaggerUI,
  addOpenAPIEndpoints,
  type OpenAPISpec,
  type InfoObject,
  type ServerObject,
  type PathsObject,
  type PathItemObject,
  type OperationObject,
  type ParameterObject,
  type RequestBodyObject,
  type ResponsesObject,
  type ResponseObject,
  type ComponentsObject,
  type SchemaObject,
  type SecuritySchemeObject,
  type SecurityRequirementObject,
  type TagObject,
  type GenerateOpenAPIOptions,
  generateSDK,
  generateMCPTools,
  generateMCPServerConfig,
  MCPGenerator,
  type MCPTool as APIMCPTool,
  type JSONSchema,
  type JSONSchemaProperty,
  type MCPServerConfig,
  RateLimiter,
  rateLimitMiddleware,
  createRateLimiter,
  DEFAULT_TIERS,
  type RateLimitConfig,
  type RateLimitTier,
  type RateLimitResult,
} from '@dotdo/api'

// === SDK - Programmatic Client ===
export {
  // Client
  DotdoClient,
  createDotdoClient,
  createDotdoClientFromEnv,
  // Errors
  DotdoSDKError,
  NotFoundError as SDKNotFoundError,
  ValidationError as SDKValidationError,
  AuthenticationError as SDKAuthenticationError,
  AuthorizationError as SDKAuthorizationError,
  RateLimitError as SDKRateLimitError,
  ServerError as SDKServerError,
  NetworkError as SDKNetworkError,
  // Types
  type DotdoClientOptions,
  type RetryOptions as SDKRetryOptions,
  type ListOptions as SDKListOptions,
  type PaginatedResponse,
  type RPCOptions,
  type ThingsResource,
  type EventsResource,
  type RelationshipsResource,
  type HealthResponse,
  // Testing
  MockDotdoClient,
  createMockClient,
  createMockDataStore,
  type MockDataStore,
  type MockClientOptions,
  createTestFixture,
  type TestFixture,
  generateTestId,
  generateMockId,
  assertThing,
  assertEvent,
  assertRelationship,
  createLocalClient,
  type LocalServerConfig,
  createResourceTracker,
  type ResourceTracker,
  // Deployment
  deploy,
  rollback,
  type DeployConfig,
  type DeployResult,
  type DeployEnvironment,
  type RollbackConfig,
  type RollbackResult,
  waitForHealthy,
  checkHealth,
  type HealthCheckResult as SDKHealthCheckResult,
  detectCIEnvironment,
  determineDeployEnvironment,
  type CIEnvironment,
  validatePrerequisites,
  createDeploymentAnnotations,
  type MigrationConfig as SDKMigrationConfig,
  type MigrationResult as SDKMigrationResult,
} from './sdk'
