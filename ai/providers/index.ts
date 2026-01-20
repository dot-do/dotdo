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
 */
const MODEL_ALIASES: Record<string, { provider: ProviderId; model: string }> = {
  // Anthropic aliases
  'opus': { provider: 'anthropic', model: 'claude-opus-4-5-20251101' },
  'claude-opus-4.5': { provider: 'anthropic', model: 'claude-opus-4-5-20251101' },
  'sonnet': { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  'claude-sonnet-4.5': { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  'haiku': { provider: 'anthropic', model: 'claude-3-5-haiku-20241022' },
  'claude-3-5-haiku': { provider: 'anthropic', model: 'claude-3-5-haiku-20241022' },

  // OpenAI aliases
  'gpt-4o': { provider: 'openai', model: 'gpt-4o' },
  'gpt-4': { provider: 'openai', model: 'gpt-4-turbo' },
  'gpt-4-turbo': { provider: 'openai', model: 'gpt-4-turbo' },
  'gpt-3.5': { provider: 'openai', model: 'gpt-3.5-turbo' },
  'gpt-3.5-turbo': { provider: 'openai', model: 'gpt-3.5-turbo' },

  // Google aliases
  'gemini': { provider: 'google', model: 'gemini-2.0-flash-exp' },
  'gemini-flash': { provider: 'google', model: 'gemini-2.0-flash-exp' },
  'gemini-pro': { provider: 'google', model: 'gemini-1.5-pro' },
  'gemini-1.5-pro': { provider: 'google', model: 'gemini-1.5-pro' },
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

/**
 * Configure the global provider settings
 */
export function configureProviders(config: ProviderConfig): void {
  globalConfig = { ...globalConfig, ...config }
  providerCache.clear()
}

/**
 * Get environment configuration
 */
function getEnvConfig(): ProviderConfig {
  if (typeof process === 'undefined') return {}

  const env = process.env
  return {
    openaiApiKey: env['OPENAI_API_KEY'],
    anthropicApiKey: env['ANTHROPIC_API_KEY'],
    googleApiKey: env['GOOGLE_GENERATIVE_AI_API_KEY'] || env['GOOGLE_AI_API_KEY'],
    cloudflareAccountId: env['CLOUDFLARE_ACCOUNT_ID'],
    cloudflareApiToken: env['CLOUDFLARE_API_TOKEN'],
    openrouterApiKey: env['OPENROUTER_API_KEY'],
    gatewayUrl: env['AI_GATEWAY_URL'],
    gatewayToken: env['AI_GATEWAY_TOKEN'] || env['DO_TOKEN'],
  }
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
  const provider = createOpenAI({
    apiKey: config.openaiApiKey,
    baseURL: config.baseUrls?.openai,
  })

  return {
    languageModel: (modelId: string) => provider(modelId),
    textEmbeddingModel: (modelId: string) => provider.embedding(modelId),
  }
}

/**
 * Create Anthropic provider
 */
async function createAnthropicProvider(config: ProviderConfig): Promise<AIProvider> {
  const { createAnthropic } = await import('@ai-sdk/anthropic')
  const provider = createAnthropic({
    apiKey: config.anthropicApiKey,
    baseURL: config.baseUrls?.anthropic,
  })

  return {
    languageModel: (modelId: string) => provider(modelId),
  }
}

/**
 * Create Google AI provider
 */
async function createGoogleProvider(config: ProviderConfig): Promise<AIProvider> {
  const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
  const provider = createGoogleGenerativeAI({
    apiKey: config.googleApiKey,
    baseURL: config.baseUrls?.google,
  })

  return {
    languageModel: (modelId: string) => provider(modelId),
    textEmbeddingModel: (modelId: string) => provider.textEmbeddingModel(modelId),
  }
}

/**
 * Create OpenRouter provider (OpenAI-compatible)
 */
async function createOpenRouterProvider(config: ProviderConfig): Promise<AIProvider> {
  const { createOpenAI } = await import('@ai-sdk/openai')
  const provider = createOpenAI({
    apiKey: config.openrouterApiKey,
    baseURL: config.baseUrls?.openrouter || 'https://openrouter.ai/api/v1',
  })

  return {
    languageModel: (modelId: string) => provider(modelId),
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
 * ```
 */
export async function model(id: string): Promise<LanguageModel> {
  const { provider: providerId, model: modelId } = parseModelId(id)
  const provider = await getProvider(providerId)
  return provider.languageModel(modelId)
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

// ============================================================================
// Re-exports for compatibility
// ============================================================================

// Export local type definitions (compatible with AI SDK types)
export type { LanguageModel, EmbeddingModel }
