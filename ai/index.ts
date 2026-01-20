// @dotdo/ai - AI Routing Layer
// Template literals, AIPromise, multi-provider routing
// Base for functions.do managed service

export * from './template'
export * from './promise'

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

export * from './stream'

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
