// dotdo - Main Package
// Re-exports all @dotdo/* packages for unified consumption
// Uses explicit exports to avoid conflicts between packages

// === @dotdo/do - Durable Objects ===
export { DO, type DOEnv, type DOOptions } from '@dotdo/do'
export { createContext, createTypedContext, type WorkflowContext, type $ } from '@dotdo/do'
export { EntityManager, withEntities, type EntityManagerOptions } from '@dotdo/do'
export {
  WithStorage,
  WithWebSocket,
  WithRPC,
  WithAuth,
  type Constructor,
  type HasStorage,
  type WithStorageOptions,
  type MixinInstance,
  type HasWebSocket,
  type WithWebSocketOptions,
  type HasRPC,
  type WithRPCOptions,
  type RPCRequest as DORPCRequest,
  type RPCResponse as DORPCResponse,
  type HasAuth,
  type WithAuthOptions,
  type ComposedType,
  type InstanceOf,
} from '@dotdo/do'
export {
  WebSocketManager,
  type WebSocketMessage,
  type WebSocketHandler,
  type BroadcastResult,
  type ConnectionMetadata,
  type ConnectionHandler,
} from '@dotdo/do'
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
export {
  createEveryProxy,
  type ScheduleHandler,
  type ScheduleInterval,
  type ScheduleRegistration,
} from '@dotdo/do'
export {
  ShardRouter,
  createShardRouter,
  fnv1aHash,
  getShardIndex,
  shardMiddleware,
  type ShardKeyConfig,
  type ShardContext,
  type ShardResult,
  type ShardRouterConfig,
} from '@dotdo/do'
export type {
  AuditLog as DOAuditLog,
  DoOptions as DODoOptions,
} from '@dotdo/do'

// === @dotdo/db - Database Layer ===
export {
  // Types
  type Thing,
  type Event,
  type Relationship,
  type ThingId,
  type EventId,
  type RelationshipId,
  type QueryOptions,
  // Storage
  ThingsStore,
  EventsStore,
  RelationshipsStore,
  // Errors
  DatabaseError,
  DbNotFoundError,
  DbValidationError,
  // Branded types
  type CorrelationId as DbCorrelationId,
  // ID generation
  generateId,
  generateEventId,
  // Pagination
  type CursorPaginatedResult,
  type CursorPaginationOptions,
  // Audit
  type AuditLog as DbAuditLog,
  type AuditLogStore,
  type AuditLogQueryOptions,
  // Schema
  createSchemaRegistry as createDbSchemaRegistry,
  type ValidationError as DbSchemaValidationError,
} from '@dotdo/db'

// === @dotdo/ai - AI Routing Layer ===
export {
  // Template literal interface
  ai,
  // AIPromise
  createAIPromise,
  type AIPromise,
  type AIMeta,
  // Providers
  providers,
  configureProviders,
  model,
  embeddingModel,
  configureAIProviders,
  clearProviderCache,
  resetConfig,
  type ProviderId,
  type AIProvider,
  type AIProviderConfig,
  // Router
  Router,
  type ModelInfo,
  type RouterConfig,
  type ExecuteOptions,
  type ExecuteResult,
  // Tracking
  UsageTracker,
  BudgetExceededError,
  globalTracker,
  countTokens,
  estimateCost,
  calculateCost,
  type ModelConfig,
  type UsageRecord,
  type UsageStats,
  type UsageReport,
  type ReportFilter,
  // AI core functions
  configureProvider,
  getProvider,
  clearProviders,
  generateText,
  generateObject,
  streamText,
  embedText,
  createTool,
  complete,
  chat,
  type Provider as AIProvider2,
  type ProviderConfig as AIProviderConfig2,
  type JSONSchema as AIJSONSchema,
  type AIFunctionDefinition,
  type AIFunctionCall,
  type AIGenerateOptions,
  type AIGenerateResult,
  type GenerateTextOptions,
  type GenerateTextResult,
  type GenerateObjectOptions,
  type GenerateObjectResult,
  type StreamTextOptions,
  type StreamTextResult,
  type EmbedTextOptions,
  type ToolDefinition,
  type Tool,
  type CompletionOptions,
  type ChatMessage,
  type ChatOptions,
  // Request context
  createRequestContext,
  runWithContext,
  getCurrentContext,
  getOrCreateContext,
  type RequestContext,
  // Primitives DSL
  list,
  extract,
  is,
  research,
  // Batching
  BatchQueue,
  BatchMapPromise as AIBatchMapPromise,
  createBatch,
  createBatchMap,
  deferToBatch,
  type BatchMapOptions as AIBatchMapOptions,
} from '@dotdo/ai'

// === @dotdo/auth - Authentication ===
export {
  authMiddleware,
  apiKeyMiddleware,
  validateToken,
  verifyTokenSignature,
  extractToken,
  checkTokenExpiration,
  type AuthOptions,
  type AuthUser,
  type TokenPayload,
  type TokenValidationOptions,
  type TokenExtractionOptions,
  type ExpirationCheckResult,
} from '@dotdo/auth'

// === @dotdo/rpc - RPC Communication ===
export {
  createClient,
  createDOStub,
  createServer,
  createWorkerFromTarget,
  // Pipeline
  createPipeline,
  PipelineBuilder,
  type PipelineStep,
  type PipelineRequest,
  type PipelineResponse,
  type PipelinePromise,
  // Batch
  type BatchMapOptions as RPCBatchMapOptions,
  type BatchMapPromise as RPCBatchMapPromise,
  // Errors
  RPCError,
  TimeoutError,
  NetworkError,
  serializeError,
  deserializeError,
  ValidationError as RPCValidationError,
  // Types
  type RPCRequest,
  type RPCResponse,
  type CorrelationId as RPCCorrelationId,
  CORRELATION_ID_HEADER as RPC_CORRELATION_ID_HEADER,
} from '@dotdo/rpc'

// === @dotdo/mcp - MCP Server ===
export {
  createMCPServer,
  searchTool,
  fetchTool,
  doTool,
  createSearchTool,
  createFetchTool,
  createSandboxTool,
  sandboxToolMetadata,
  createSandbox,
  RateLimiter as MCPRateLimiter,
  ConcurrencyLimiter,
  SandboxResourceEnforcer,
  createScopedResourceEnforcer,
  ToolRegistry,
  ToolCategory,
  type MCPServerOptions,
  type MCPServer,
  type MCPTool as MCPToolType,
  type Sandbox,
  type SandboxOptions,
  type SandboxResult,
  type SandboxPermissions,
  type AuditLog as MCPAuditLog,
  type ResourceLimits,
  type ResourceUsage,
  type RateLimitConfig as MCPRateLimitConfig,
  type ConcurrencyLimitConfig,
  type ToolMetadata,
} from '@dotdo/mcp'

// === @dotdo/api - Self-Describing API ===
export {
  createAPI,
  defineResource,
  getResource,
  getAllResources,
  clearRegistry,
  clearGlobalRegistry,
  createResourceContext,
  runWithResourceContext,
  getCurrentResourceContext,
  getOrCreateResourceContext,
  type ResourceContext,
  type ResourceDefinition,
  type ResourceFields,
  type FieldDef as APIFieldDef,
  type RelationDef,
  type ActionDef,
  type HookDef,
  type ComputedFieldDef,
  type RouteDefinitions,
  // HATEOAS
  generateLinks,
  generateCollectionLinks,
  withLinks,
  withCollectionLinks,
  type Link,
  type HATEOASResponse,
  type ResourceConfig,
  // OpenAPI
  generateOpenAPI,
  OpenAPIGenerator,
  specToYAML,
  createSwaggerUI,
  addOpenAPIEndpoints,
  type OpenAPISpec,
  type GenerateOpenAPIOptions,
  // SDK
  generateSDK,
  // MCP Codegen
  generateMCPTools,
  generateMCPServerConfig,
  MCPGenerator,
  type MCPTool as APIMCPTool,
  type JSONSchema as APIJSONSchema,
  type MCPServerConfig,
  // Rate limiting
  RateLimiter as APIRateLimiter,
  rateLimitMiddleware,
  createRateLimiter,
  DEFAULT_TIERS,
  type RateLimitConfig as APIRateLimitConfig,
  type RateLimitTier,
  type RateLimitResult,
  type RateLimitSqlStorage,
} from '@dotdo/api'
