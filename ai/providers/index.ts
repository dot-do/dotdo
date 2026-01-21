/**
 * AI Providers Module for @dotdo/ai
 *
 * Provides a unified interface for accessing multiple AI providers.
 * This module can be used standalone or integrated with the primitives
 * ai-providers package when available.
 *
 * Supports:
 * - OpenAI (GPT-4, GPT-3.5)
 * - Anthropic (Claude)
 * - Google (Gemini)
 * - Cloudflare Workers AI
 *
 * @packageDocumentation
 */

// Type declarations for AI SDK - these may not be available at compile time
// but are dynamically imported when needed
interface LanguageModel {
  modelId: string
  provider: string
  specificationVersion: string
  doGenerate?: (options: unknown) => Promise<unknown>
  doStream?: (options: unknown) => Promise<unknown>
}

interface EmbeddingModel<T extends string = string> {
  modelId: string
  provider: string
  specificationVersion: string
  doEmbed?: (options: unknown) => Promise<unknown>
}

// Declare process for Node.js environments
declare const process: { env: Record<string, string | undefined> } | undefined

// ============================================================================
// Types
// ============================================================================

/**
 * Supported AI provider identifiers
 */
export type ProviderId = 'openai' | 'anthropic' | 'google' | 'cloudflare' | 'openrouter' | 'bedrock'

/**
 * Provider configuration options
 */
export interface ProviderConfig {
  /** OpenAI API key */
  openaiApiKey?: string
  /** Anthropic API key */
  anthropicApiKey?: string
  /** Google AI API key */
  googleApiKey?: string
  /** Cloudflare Account ID */
  cloudflareAccountId?: string
  /** Cloudflare API Token */
  cloudflareApiToken?: string
  /** OpenRouter API key */
  openrouterApiKey?: string
  /** Cloudflare AI Gateway URL */
  gatewayUrl?: string
  /** AI Gateway auth token */
  gatewayToken?: string
  /** Custom base URLs per provider */
  baseUrls?: Partial<Record<ProviderId, string>>
}

/**
 * Provider interface for creating language and embedding models
 */
export interface AIProvider {
  /** Create a language model for text generation */
  languageModel(modelId: string): LanguageModel
  /** Create an embedding model (optional) */
  textEmbeddingModel?(modelId: string): EmbeddingModel<string>
}

/**
 * Model alias mapping for convenience names
 * Updated January 2026 to match current provider offerings
 */
const MODEL_ALIASES: Record<string, { provider: ProviderId; model: string }> = {
  // ==========================================================================
  // Anthropic Aliases
  // ==========================================================================
  'opus': { provider: 'anthropic', model: 'claude-opus-4-5-20251101' },
  'claude-opus-4.5': { provider: 'anthropic', model: 'claude-opus-4-5-20251101' },
  'claude-opus-4-5': { provider: 'anthropic', model: 'claude-opus-4-5-20251101' },

  'sonnet': { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  'claude-sonnet-4': { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  'claude-sonnet-4.5': { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },

  'haiku': { provider: 'anthropic', model: 'claude-3-5-haiku-20241022' },
  'claude-3-5-haiku': { provider: 'anthropic', model: 'claude-3-5-haiku-20241022' },
  'claude-3.5-haiku': { provider: 'anthropic', model: 'claude-3-5-haiku-20241022' },

  // Legacy Claude 3.5 Sonnet
  'claude-3.5-sonnet': { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
  'claude-3-5-sonnet': { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },

  // ==========================================================================
  // OpenAI Aliases
  // ==========================================================================
  'gpt-4o': { provider: 'openai', model: 'gpt-4o' },
  'gpt-4o-mini': { provider: 'openai', model: 'gpt-4o-mini' },
  'gpt-4': { provider: 'openai', model: 'gpt-4-turbo' },
  'gpt-4-turbo': { provider: 'openai', model: 'gpt-4-turbo' },
  'gpt-3.5': { provider: 'openai', model: 'gpt-3.5-turbo' },
  'gpt-3.5-turbo': { provider: 'openai', model: 'gpt-3.5-turbo' },

  // o-series reasoning models
  'o1': { provider: 'openai', model: 'o1' },
  'o1-mini': { provider: 'openai', model: 'o1-mini' },
  'o3-mini': { provider: 'openai', model: 'o3-mini' },

  // ==========================================================================
  // Google Aliases
  // ==========================================================================
  'gemini': { provider: 'google', model: 'gemini-2.0-flash' },
  'gemini-flash': { provider: 'google', model: 'gemini-2.0-flash' },
  'gemini-2.0-flash': { provider: 'google', model: 'gemini-2.0-flash' },
  'gemini-2.0-flash-thinking': { provider: 'google', model: 'gemini-2.0-flash-thinking-exp' },
  'gemini-pro': { provider: 'google', model: 'gemini-1.5-pro' },
  'gemini-1.5-pro': { provider: 'google', model: 'gemini-1.5-pro' },
  'gemini-1.5-flash': { provider: 'google', model: 'gemini-1.5-flash' },
}

/**
 * Embedding model aliases
 */
const EMBEDDING_ALIASES: Record<string, { provider: ProviderId; model: string }> = {
  'text-embedding-3-small': { provider: 'openai', model: 'text-embedding-3-small' },
  'text-embedding-3-large': { provider: 'openai', model: 'text-embedding-3-large' },
  'text-embedding-ada-002': { provider: 'openai', model: 'text-embedding-ada-002' },
}

// ============================================================================
// Provider Registry
// ============================================================================

let globalConfig: ProviderConfig = {}
let providerCache = new Map<ProviderId, AIProvider>()

// Fallback chain configuration for the providers module
interface ModelFallbackConfig {
  /** Enable automatic fallback for model() calls */
  enabled: boolean
  /** Ordered list of providers to try */
  providers: ProviderId[]
  /** Maximum retries per provider */
  maxRetriesPerProvider: number
}

let modelFallbackConfig: ModelFallbackConfig = {
  enabled: false,
  providers: ['anthropic', 'openai', 'google'],
  maxRetriesPerProvider: 2,
}

/**
 * Configure the global provider settings
 */
export function configureProviders(config: ProviderConfig): void {
  globalConfig = { ...globalConfig, ...config }
  providerCache.clear()
}

/**
 * Configure model fallback behavior.
 *
 * When enabled, model() will automatically try fallback providers
 * if the primary provider fails.
 *
 * @example
 * ```ts
 * import { configureModelFallback } from '@dotdo/ai'
 *
 * configureModelFallback({
 *   enabled: true,
 *   providers: ['anthropic', 'openai', 'google'],
 *   maxRetriesPerProvider: 2,
 * })
 * ```
 */
export function configureModelFallback(config: Partial<ModelFallbackConfig>): void {
  modelFallbackConfig = { ...modelFallbackConfig, ...config }
}

/**
 * Get current model fallback configuration (for testing).
 * @internal
 */
export function _getModelFallbackConfig(): ModelFallbackConfig {
  return { ...modelFallbackConfig }
}

/**
 * Get environment configuration
 */
function getEnvConfig(): ProviderConfig {
  if (typeof process === 'undefined') return {}

  const env = process.env
  const config: ProviderConfig = {}

  // Only set values that are defined
  if (env['OPENAI_API_KEY']) config.openaiApiKey = env['OPENAI_API_KEY']
  if (env['ANTHROPIC_API_KEY']) config.anthropicApiKey = env['ANTHROPIC_API_KEY']
  const googleKey = env['GOOGLE_GENERATIVE_AI_API_KEY'] || env['GOOGLE_AI_API_KEY']
  if (googleKey) config.googleApiKey = googleKey
  if (env['CLOUDFLARE_ACCOUNT_ID']) config.cloudflareAccountId = env['CLOUDFLARE_ACCOUNT_ID']
  if (env['CLOUDFLARE_API_TOKEN']) config.cloudflareApiToken = env['CLOUDFLARE_API_TOKEN']
  if (env['OPENROUTER_API_KEY']) config.openrouterApiKey = env['OPENROUTER_API_KEY']
  if (env['AI_GATEWAY_URL']) config.gatewayUrl = env['AI_GATEWAY_URL']
  const gatewayToken = env['AI_GATEWAY_TOKEN'] || env['DO_TOKEN']
  if (gatewayToken) config.gatewayToken = gatewayToken

  return config
}

/**
 * Get merged configuration (env + global)
 */
function getMergedConfig(): ProviderConfig {
  return { ...getEnvConfig(), ...globalConfig }
}

// ============================================================================
// Provider Implementations
// ============================================================================

/**
 * Create OpenAI provider
 */
async function createOpenAIProvider(config: ProviderConfig): Promise<AIProvider> {
  const { createOpenAI } = await import('@ai-sdk/openai')
  // Build settings object conditionally to avoid passing undefined values
  const settings: Record<string, unknown> = {}
  if (config.openaiApiKey) settings['apiKey'] = config.openaiApiKey
  if (config.baseUrls?.openai) settings['baseURL'] = config.baseUrls.openai
  const provider = createOpenAI(settings as Parameters<typeof createOpenAI>[0])

  return {
    languageModel: (modelId: string) => provider(modelId) as unknown as LanguageModel,
    textEmbeddingModel: (modelId: string) => provider.embedding(modelId) as unknown as EmbeddingModel<string>,
  }
}

/**
 * Create Anthropic provider
 */
async function createAnthropicProvider(config: ProviderConfig): Promise<AIProvider> {
  const { createAnthropic } = await import('@ai-sdk/anthropic')
  // Build settings object conditionally to avoid passing undefined values
  const settings: Record<string, unknown> = {}
  if (config.anthropicApiKey) settings['apiKey'] = config.anthropicApiKey
  if (config.baseUrls?.anthropic) settings['baseURL'] = config.baseUrls.anthropic
  const provider = createAnthropic(settings as Parameters<typeof createAnthropic>[0])

  return {
    languageModel: (modelId: string) => provider(modelId) as unknown as LanguageModel,
  }
}

/**
 * Create Google AI provider
 */
async function createGoogleProvider(config: ProviderConfig): Promise<AIProvider> {
  const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
  // Build settings object conditionally to avoid passing undefined values
  const settings: Record<string, unknown> = {}
  if (config.googleApiKey) settings['apiKey'] = config.googleApiKey
  if (config.baseUrls?.google) settings['baseURL'] = config.baseUrls.google
  const provider = createGoogleGenerativeAI(settings as Parameters<typeof createGoogleGenerativeAI>[0])

  return {
    languageModel: (modelId: string) => provider(modelId) as unknown as LanguageModel,
    textEmbeddingModel: (modelId: string) => provider.textEmbeddingModel(modelId) as unknown as EmbeddingModel<string>,
  }
}

/**
 * Create OpenRouter provider (OpenAI-compatible)
 */
async function createOpenRouterProvider(config: ProviderConfig): Promise<AIProvider> {
  const { createOpenAI } = await import('@ai-sdk/openai')
  // Build settings object conditionally to avoid passing undefined values
  const settings: Record<string, unknown> = {
    baseURL: config.baseUrls?.openrouter || 'https://openrouter.ai/api/v1',
  }
  if (config.openrouterApiKey) settings['apiKey'] = config.openrouterApiKey
  const provider = createOpenAI(settings as Parameters<typeof createOpenAI>[0])

  return {
    languageModel: (modelId: string) => provider(modelId) as unknown as LanguageModel,
  }
}

/**
 * Provider factory map
 */
const providerFactories: Record<ProviderId, (config: ProviderConfig) => Promise<AIProvider>> = {
  openai: createOpenAIProvider,
  anthropic: createAnthropicProvider,
  google: createGoogleProvider,
  openrouter: createOpenRouterProvider,
  cloudflare: async () => {
    throw new Error('Cloudflare provider requires @dotdo/ai cloudflare integration')
  },
  bedrock: async () => {
    throw new Error('Bedrock provider requires @ai-sdk/amazon-bedrock')
  },
}

/**
 * Get or create a provider instance
 */
async function getProvider(providerId: ProviderId): Promise<AIProvider> {
  if (providerCache.has(providerId)) {
    return providerCache.get(providerId)!
  }

  const config = getMergedConfig()
  const factory = providerFactories[providerId]
  if (!factory) {
    throw new Error(`Unknown provider: ${providerId}`)
  }

  const provider = await factory(config)
  providerCache.set(providerId, provider)
  return provider
}

// ============================================================================
// Model Resolution
// ============================================================================

/**
 * Parse a model ID into provider and model name
 *
 * Supports formats:
 * - 'provider:model' (e.g., 'openai:gpt-4o')
 * - 'provider/model' (e.g., 'anthropic/claude-3-opus')
 * - 'alias' (e.g., 'opus', 'sonnet', 'gpt-4o')
 */
function parseModelId(id: string): { provider: ProviderId; model: string } {
  // Check aliases first
  const alias = MODEL_ALIASES[id]
  if (alias) {
    return alias
  }

  // Check for provider:model format
  const colonIndex = id.indexOf(':')
  if (colonIndex > 0) {
    return {
      provider: id.substring(0, colonIndex) as ProviderId,
      model: id.substring(colonIndex + 1),
    }
  }

  // Check for provider/model format
  const slashIndex = id.indexOf('/')
  if (slashIndex > 0) {
    return {
      provider: id.substring(0, slashIndex) as ProviderId,
      model: id.substring(slashIndex + 1),
    }
  }

  // Infer provider from model name patterns
  if (id.startsWith('claude')) {
    return { provider: 'anthropic', model: id }
  }
  if (id.startsWith('gpt')) {
    return { provider: 'openai', model: id }
  }
  if (id.startsWith('gemini')) {
    return { provider: 'google', model: id }
  }

  // Default to OpenRouter for unknown models
  return { provider: 'openrouter', model: id }
}

/**
 * Parse an embedding model ID
 */
function parseEmbeddingModelId(id: string): { provider: ProviderId; model: string } {
  // Check aliases first
  const alias = EMBEDDING_ALIASES[id]
  if (alias) {
    return alias
  }

  // Check for provider:model format
  const colonIndex = id.indexOf(':')
  if (colonIndex > 0) {
    return {
      provider: id.substring(0, colonIndex) as ProviderId,
      model: id.substring(colonIndex + 1),
    }
  }

  // Default to OpenAI for embedding models
  return { provider: 'openai', model: id }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get a language model by ID
 *
 * Supports aliases (opus, sonnet, gpt-4o) and full IDs (openai:gpt-4o, anthropic/claude-3-opus)
 *
 * When fallback is enabled via configureModelFallback(), this function will
 * automatically try alternative providers if the primary provider fails.
 *
 * @example
 * ```ts
 * import { model } from 'ai-providers'
 *
 * // Using aliases
 * const opus = await model('opus')
 * const sonnet = await model('sonnet')
 * const gpt4 = await model('gpt-4o')
 *
 * // Using full IDs
 * const claude = await model('anthropic:claude-3-opus')
 * const gpt = await model('openai/gpt-4-turbo')
 *
 * // With fallback enabled
 * configureModelFallback({ enabled: true })
 * const model = await model('gpt-4') // Will try openai, then fallback providers
 * ```
 */
export async function model(id: string): Promise<LanguageModel> {
  const { provider: providerId, model: modelId } = parseModelId(id)

  // If fallback is not enabled, use direct provider access
  if (!modelFallbackConfig.enabled) {
    const provider = await getProvider(providerId)
    return provider.languageModel(modelId)
  }

  // Build fallback chain: primary provider first, then configured fallbacks
  const fallbackProviders = [
    providerId,
    ...modelFallbackConfig.providers.filter(p => p !== providerId),
  ]

  const errors: Array<{ provider: ProviderId; error: Error }> = []

  for (const fallbackProvider of fallbackProviders) {
    for (let attempt = 0; attempt < modelFallbackConfig.maxRetriesPerProvider; attempt++) {
      try {
        const provider = await getProvider(fallbackProvider)

        // For fallback providers, we need to find an equivalent model
        const effectiveModelId = fallbackProvider === providerId
          ? modelId
          : getEquivalentModel(modelId, providerId, fallbackProvider)

        return provider.languageModel(effectiveModelId)
      } catch (error) {
        const err = error as Error & { status?: number }

        // Check if this is a rate limit error (should retry)
        if (isRateLimitError(err) && attempt < modelFallbackConfig.maxRetriesPerProvider - 1) {
          // Wait with exponential backoff before retry
          await sleep(Math.pow(2, attempt) * 1000)
          continue
        }

        errors.push({ provider: fallbackProvider, error: err })
        break // Move to next provider
      }
    }
  }

  // All providers failed - throw aggregated error
  const attempted = errors.map(e => e.provider).join(', ')
  const lastError = errors[errors.length - 1]?.error.message || 'Unknown error'
  throw new Error(`All providers failed [tried: ${attempted}]: ${lastError}`)
}

/**
 * Get an equivalent model from a different provider.
 * Maps models across providers for fallback functionality.
 */
function getEquivalentModel(modelId: string, fromProvider: ProviderId, toProvider: ProviderId): string {
  // Model equivalence mappings
  const equivalents: Record<string, Partial<Record<ProviderId, string>>> = {
    // GPT-4 class models
    'gpt-4o': {
      anthropic: 'claude-sonnet-4-20250514',
      google: 'gemini-1.5-pro',
    },
    'gpt-4-turbo': {
      anthropic: 'claude-sonnet-4-20250514',
      google: 'gemini-1.5-pro',
    },
    'gpt-4': {
      anthropic: 'claude-sonnet-4-20250514',
      google: 'gemini-1.5-pro',
    },
    // GPT-3.5 class models (fast/cheap)
    'gpt-3.5-turbo': {
      anthropic: 'claude-3-5-haiku-20241022',
      google: 'gemini-2.0-flash',
    },
    'gpt-4o-mini': {
      anthropic: 'claude-3-5-haiku-20241022',
      google: 'gemini-2.0-flash',
    },
    // Claude models
    'claude-opus-4-5-20251101': {
      openai: 'gpt-4o',
      google: 'gemini-1.5-pro',
    },
    'claude-sonnet-4-20250514': {
      openai: 'gpt-4o',
      google: 'gemini-1.5-pro',
    },
    'claude-3-5-sonnet-20241022': {
      openai: 'gpt-4o',
      google: 'gemini-1.5-pro',
    },
    'claude-3-5-haiku-20241022': {
      openai: 'gpt-4o-mini',
      google: 'gemini-2.0-flash',
    },
    // Gemini models
    'gemini-1.5-pro': {
      openai: 'gpt-4o',
      anthropic: 'claude-sonnet-4-20250514',
    },
    'gemini-2.0-flash': {
      openai: 'gpt-4o-mini',
      anthropic: 'claude-3-5-haiku-20241022',
    },
  }

  const mapping = equivalents[modelId]?.[toProvider]
  if (mapping) {
    return mapping
  }

  // Default fallback: try to use a general-purpose model from the target provider
  const defaultModels: Record<ProviderId, string> = {
    openai: 'gpt-4o',
    anthropic: 'claude-sonnet-4-20250514',
    google: 'gemini-1.5-pro',
    cloudflare: '@cf/meta/llama-3.1-8b-instruct',
    openrouter: 'anthropic/claude-sonnet-4-20250514',
    bedrock: 'anthropic.claude-3-sonnet-20240229-v1:0',
  }

  return defaultModels[toProvider] || modelId
}

/**
 * Check if an error is a rate limit error.
 */
function isRateLimitError(error: Error & { status?: number; code?: string | number }): boolean {
  if (error.status === 429) return true

  const code = error.code
  if (typeof code === 'string') {
    const codeLower = code.toLowerCase()
    if (
      codeLower === 'rate_limit_exceeded' ||
      codeLower === 'rate_limit_error' ||
      codeLower === 'too_many_requests'
    ) {
      return true
    }
  }

  const message = error.message?.toLowerCase() || ''
  return message.includes('rate limit') || message.includes('429') || message.includes('too many requests')
}

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Get an embedding model by ID
 *
 * @example
 * ```ts
 * import { embeddingModel } from 'ai-providers'
 *
 * const embedder = await embeddingModel('text-embedding-3-small')
 * const cloudflare = await embeddingModel('cloudflare:@cf/baai/bge-m3')
 * ```
 */
export async function embeddingModel(id: string): Promise<EmbeddingModel<string>> {
  const { provider: providerId, model: modelId } = parseEmbeddingModelId(id)
  const provider = await getProvider(providerId)

  if (!provider.textEmbeddingModel) {
    throw new Error(`Provider ${providerId} does not support embedding models`)
  }

  return provider.textEmbeddingModel(modelId)
}

/**
 * Clear provider cache (useful for testing)
 */
export function clearProviderCache(): void {
  providerCache.clear()
}

/**
 * Reset all configuration (useful for testing)
 */
export function resetConfig(): void {
  globalConfig = {}
  providerCache.clear()
}

/**
 * Get current configuration for testing/debugging.
 * WARNING: Exposes internal state - use only for testing!
 *
 * @internal
 */
export function _getConfigForTesting(): ProviderConfig {
  return { ...globalConfig }
}

// ============================================================================
// Re-exports for compatibility
// ============================================================================

// Export local type definitions (compatible with AI SDK types)
export type { LanguageModel, EmbeddingModel }
