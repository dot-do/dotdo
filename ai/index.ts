// @dotdo/ai - AI Routing Layer
// Thin wrapper around ai-functions from primitives
// Provides template literals, AIPromise, multi-provider routing
// Base for functions.do managed service

// ============================================================================
// Re-export primitives from ai-functions
// This is the primary source - use these for all AI operations
// ============================================================================

// Core AI primitives (generate, ai template, write, code, list, etc.)
export {
  // Core generation
  generate,
  generateObject,
  generateText,
  streamObject,
  streamText,
  type GenerateType,
  type GenerateOptions,

  // Template functions
  ai as aiPrimitive,
  write as writePrimitive,
  code as codePrimitive,
  list,
  lists,
  extract,
  summarize as summarizePrimitive,
  is,

  // Media generation
  diagram,
  slides,
  image,
  video,

  // Agentic primitives
  do as doTask,
  research,
  read,
  browse,
  decide,
  ask,
  approve,
  review,
  type HumanOptions,
  type HumanResult,

  // AIPromise system
  AIPromise,
  isAIPromise,
  getRawPromise,
  createTextPromise,
  createObjectPromise,
  createListPromise,
  createListsPromise,
  createBooleanPromise,
  createExtractPromise,
  createAITemplateFunction,
  parseTemplateWithDependencies,
  AI_PROMISE_SYMBOL,
  RAW_PROMISE_SYMBOL,
  type AIPromiseOptions,
  type StreamingAIPromise,
  type StreamOptions as AIStreamOptions,

  // Template utilities
  parseTemplate,
  createTemplateFunction,
  createChainablePromise,
  createStreamableList,
  withBatch,
  type FunctionOptions,
  type TemplateFunction,
  type BatchableFunction,
  type StreamableList,
  type ChainablePromise,

  // Schema utilities
  schema,
  type SimpleSchema,
  isZodSchema,

  // Context management
  configure,
  getContext,
  withContext,
  getGlobalContext,
  resetContext,
  getModel,
  getProvider as getPrimitiveProvider,
  type ExecutionContext,

  // Core types
  type AIFunctionDefinition,
  type JSONSchema,
  type AIGenerateOptions,
  type AIGenerateResult,
  type AIFunctionCall,
  type AIClient,
  type ImageOptions,
  type ImageResult,
  type VideoOptions,
  type VideoResult,
  type WriteOptions,
  type ListItem,
  type ListResult,
  type NamedList,
  type ListsResult,
  type CodeLanguage,
  type GenerativeOutputType,
  type HumanChannel,
  type LegacyHumanChannel,
  type SchemaLimitations,
  type BaseFunctionDefinition,
  type CodeFunctionDefinition,
  type CodeFunctionResult,
  type GenerativeFunctionDefinition,
  type GenerativeFunctionResult,
  type AgenticFunctionDefinition,
  type AgenticExecutionState,
  type HumanFunctionDefinition,
  type HumanFunctionResult,
  type FunctionDefinition,
  type DefinedFunction,
  type FunctionRegistry,
  type AutoDefineResult,
} from 'ai-functions'

// AI Proxy and function definition
export {
  AI,
  ai as aiProxy,
  aiPrompt,
  define,
  defineFunction,
  functions,
  createFunctionRegistry,
  resetGlobalRegistry,
  withTemplate,
  type AIProxy,
} from 'ai-functions'

// Batch processing
export {
  BatchQueue,
  createBatch,
  withBatch as withBatchQueue,
  registerBatchAdapter,
  getBatchAdapter,
  isBatchMode,
  deferToBatch,
  BATCH_MODE_SYMBOL,
  type BatchMode as BatchQueueMode,
  type BatchProvider,
  type BatchStatus,
  type BatchItem,
  type BatchJob,
  type BatchResult,
  type BatchSubmitResult,
  type BatchAdapter,
  type BatchQueueOptions,
  type DeferredOptions,

  // Batch map for automatic batching
  BatchMapPromise,
  createBatchMap,
  isBatchMapPromise,
  BATCH_MAP_SYMBOL,
  type CapturedOperation,
  type BatchMapOptions,
} from 'ai-functions'

// Budget tracking and request tracing
export {
  BudgetTracker,
  TokenCounter,
  RequestContext as PrimitivesRequestContext,
  BudgetExceededError as PrimitivesBudgetExceededError,
  createRequestContext as createPrimitivesRequestContext,
  withBudget,
  type BudgetConfig,
  type BudgetAlert,
  type BudgetSnapshot,
  type TokenUsage,
  type RequestInfo,
  type RequestContextOptions,
  type ModelPricing as PrimitivesModelPricing,
  type WithBudgetOptions,
  type RemainingBudget,
  type CheckBudgetOptions,
} from 'ai-functions'

// Retry/resilience patterns
export {
  RetryableError,
  NonRetryableError,
  NetworkError,
  RateLimitError,
  CircuitOpenError,
  ErrorCategory,
  classifyError,
  calculateBackoff,
  RetryPolicy,
  CircuitBreaker,
  FallbackChain,
  withRetry,
  type JitterStrategy,
  type BackoffOptions,
  type RetryOptions,
  type RetryInfo,
  type BatchItemResult,
  type CircuitState,
  type CircuitBreakerOptions,
  type CircuitBreakerMetrics,
  type FallbackModel,
  type FallbackOptions,
  type FallbackMetrics,
} from 'ai-functions'

// Caching layer
export {
  MemoryCache,
  EmbeddingCache,
  GenerationCache,
  withCache,
  hashKey,
  createCacheKey,
  type CacheStorage,
  type CacheEntry,
  type CacheOptions,
  type CacheStats,
  type MemoryCacheOptions,
  type CacheKeyType,
  type EmbeddingCacheOptions,
  type BatchEmbeddingResult,
  type GenerationParams,
  type GenerationCacheGetOptions,
  type WithCacheOptions,
  type CachedFunction,
} from 'ai-functions'

// Tool orchestration
export {
  AgenticLoop,
  ToolRouter,
  ToolValidator,
  createTool as createAgenticTool,
  createToolset,
  wrapTool,
  cachedTool,
  rateLimitedTool,
  timeoutTool,
  createAgenticLoop,
  type Tool as AgenticTool,
  type ToolCall,
  type ToolResult,
  type FormattedToolResult,
  type ValidationResult,
  type ModelResponse,
  type Message,
  type StepInfo,
  type LoopOptions,
  type RunOptions,
  type ToolCallResult,
  type SDKToolResult,
  type LoopResult,
  type LoopStreamEvent,
} from 'ai-functions'

// Context utilities from ai-functions
export {
  getBatchMode,
  getBatchThreshold,
  shouldUseBatchAPI,
  getFlexThreshold,
  getExecutionTier,
  isFlexAvailable,
  type BatchMode,
  type ContextBudgetConfig,
  type ExecutionTier,
} from 'ai-functions'

// Embeddings
export * from 'ai-functions/embeddings'

// Digital Objects function registry
export {
  DigitalObjectsFunctionRegistry,
  createDigitalObjectsRegistry,
  FUNCTION_NOUNS,
  FUNCTION_VERBS,
  type StoredFunctionDefinition,
  type FunctionCallData,
  type DigitalObjectsRegistryOptions,
} from 'ai-functions'

// ============================================================================
// dotdo-specific modules (not from primitives)
// These provide dotdo-specific features like WorkflowContext integration
// ============================================================================

// dotdo template literal interface (wraps primitives with dotdo-specific features)
export * from './template'

// dotdo AIPromise wrapper with $meta tracking
export * from './promise'

// Stream utilities for dotdo
export * from './stream'

// Export centralized types (single source of truth)
export type { Provider, ProviderConfig, Capability, LoadBalancingStrategy } from './types'

// Export from providers (includes router exports)
export {
  providers,
  configureProviders,
  // From providers/index.ts via providers.ts
  model,
  embeddingModel,
  configureAIProviders,
  clearProviderCache,
  resetConfig,
  type ProviderId,
  type AIProvider,
  type AIProviderConfig,
} from './providers'

// Export router items that don't conflict with providers
export {
  Router,
  type ModelInfo,
  type RouterConfig,
  type ExecuteOptions,
  type ExecuteResult,
} from './router'

// Export tracking items that don't conflict with providers (Provider exported above)
export {
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
} from './tracking'

// Export tokens module items that don't conflict with tracking
export {
  countMessageTokens,
  getModelPricing,
  preloadEncoders,
  clearEncoderCache,
  type ModelPricing,
  type Tiktoken,
} from './tokens'

// Export ai-core items that don't conflict (Provider, ProviderConfig exported above)
export {
  // Types
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
  // Functions
  configureProvider,
  getProvider,
  clearProviders,
  generateText as dotdoGenerateText,
  generateObject as dotdoGenerateObject,
  streamText as dotdoStreamText,
  embedText,
  createTool,
  complete,
  chat,
} from './ai-core'

// Export request-scoped context for proper isolation
// Use these instead of globalTracker to avoid state leakage between requests
export {
  createRequestContext,
  runWithContext,
  getCurrentContext,
  getOrCreateContext,
  type RequestContext,
} from './context'
