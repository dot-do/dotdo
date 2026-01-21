// Multi-provider routing - implemented in router.ts
// This file maintains backward compatibility with existing imports

export type { Provider, ProviderConfig } from './router'
export { providers, configureProviders } from './router'

// Re-export ai-providers module for model/embeddingModel access
// Note: ProviderId is similar to Provider but includes more providers
// AIProviderConfig is the config type for the ai-providers module
export {
  model,
  embeddingModel,
  configureProviders as configureAIProviders,
  clearProviderCache,
  resetConfig,
  type ProviderId,
  type AIProvider,
  type ProviderConfig as AIProviderConfig,
} from './providers/index.js'
