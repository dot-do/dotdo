// @dotdo/ai - AI Routing Layer
// Template literals, AIPromise, multi-provider routing
// Base for functions.do managed service

// ============================================================================
// Re-export from ai-functions (primitives) when available
// Currently these are stubbed to maintain backward compatibility
// until the primitives submodule build is fixed
// ============================================================================

// Note: ai-functions exports are commented out until primitives build is fixed
// Once fixed, uncomment and remove duplicates from local modules:
// export * from 'ai-functions'

// ============================================================================
// Local implementations (will be deprecated once ai-functions is integrated)
// These provide the current dotdo-specific AI functionality
// ============================================================================

// dotdo template literal interface
export * from './template'

// dotdo AIPromise wrapper with $meta tracking
// Explicitly export AIPromise types for clarity
// (Also re-exported from ai-functions when primitives build is fixed)
export type { AIPromise, AIMeta } from "./promise"
export { createAIPromise } from "./promise"

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
  type JSONSchema,
  type AIFunctionDefinition,
  type AIFunctionCall,
  type AIGenerateOptions,
  type AIGenerateResult,
  type SimpleSchema,
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
  generateText,
  generateObject,
  streamText,
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

// ============================================================================
// Export primitives DSL from ai-functions (do-8wsa.6)
// These provide convenient template literal syntax for common AI operations
// ============================================================================

export {
  list,
  extract,
  is,
  research,
} from 'ai-functions'

// ============================================================================
// Export batching utilities from ai-functions (primitives)
// These provide automatic batch processing for AI operations
// ============================================================================

export {
  BatchQueue,
  BatchMapPromise,
  createBatch,
  createBatchMap,
  deferToBatch,
  getBatchAdapter,
  registerBatchAdapter,
  isBatchMode,
  isBatchMapPromise,
  withBatchQueue,
  BATCH_MODE_SYMBOL,
  BATCH_MAP_SYMBOL,
  type BatchQueueMode,
  type BatchProvider,
  type BatchStatus,
  type BatchItem,
  type BatchJob,
  type BatchResult,
  type BatchSubmitResult,
  type BatchAdapter,
  type BatchQueueOptions,
  type DeferredOptions,
  type CapturedOperation,
  type BatchMapOptions,
} from 'ai-functions'

// ============================================================================
// Re-export from ai-providers (primitives submodule)
// These provide unified AI provider registry with Cloudflare AI Gateway support
// ============================================================================

// Registry functions for unified provider access
export {
  createRegistry,
  getRegistry,
  configureRegistry,
  DIRECT_PROVIDERS,
  type DirectProvider,
  type ProviderConfig as AIProvidersConfig,
} from 'ai-providers'

// llm.do WebSocket transport for persistent connections
export {
  LLM,
  getLLM,
  createLLMFetch,
  type LLMConfig,
  type UniversalRequest,
  type UniversalCreated,
  type UniversalStream,
  type UniversalDone,
  type UniversalError,
  type GatewayMessage,
} from 'ai-providers'

// Re-export AI SDK types from ai-providers for convenience
// Note: 'Provider' from ai-providers is re-exported as 'AISDKProvider' to avoid
// conflict with local 'AIProvider' type from ./providers
export type { Provider as AISDKProvider, ProviderRegistryProvider } from 'ai-providers'
