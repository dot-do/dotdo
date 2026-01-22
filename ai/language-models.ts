/**
 * Language models pricing and information
 *
 * Re-exports from primitives/packages/language-models for use in @dotdo/ai.
 * This data is sourced from OpenRouter's API and provides accurate, up-to-date pricing.
 *
 * NOTE: JSON data is loaded via static import for Workers compatibility.
 */

// Import JSON data statically (works in both Node.js and Workers)
import modelsData from '../primitives/packages/language-models/data/models.json'

/**
 * Provider endpoint information for direct API access
 */
export interface ProviderEndpoint {
  /** Provider's API base URL (e.g., https://api.anthropic.com/v1) */
  baseUrl: string
  /** Provider's model ID (e.g., claude-opus-4-5-20251101) */
  modelId: string
}

/**
 * Model pricing information (per token, as strings)
 */
export interface ModelPricing {
  /** Cost per input token (as string, e.g., "0.000005") */
  prompt: string
  /** Cost per output token (as string, e.g., "0.000025") */
  completion: string
  /** Cost per request if applicable */
  request?: string
  /** Cost per image if applicable */
  image?: string
  /** Cost for web search */
  web_search?: string
  /** Cost for internal reasoning */
  internal_reasoning?: string
  /** Cost for cache read */
  input_cache_read?: string
  /** Cost for cache write */
  input_cache_write?: string
}

/**
 * Model information from OpenRouter
 */
export interface ModelInfo {
  /** OpenRouter model ID (e.g., "anthropic/claude-opus-4.5") */
  id: string
  /** Human-readable model name */
  name: string
  /** Model description */
  description?: string
  /** Maximum context length in tokens */
  context_length: number
  /** Pricing per token */
  pricing: ModelPricing
  /** Model architecture information */
  architecture?: {
    modality: string
    input_modalities: string[]
    output_modalities: string[]
  }
  /** Provider slug (e.g., 'anthropic', 'openai', 'google') */
  provider?: string
  /** Provider's native model ID for direct API calls */
  provider_model_id?: string
  /** Provider endpoint info for direct routing */
  endpoint?: ProviderEndpoint
}

// Model aliases (short names to full IDs)
export const ALIASES: Record<string, string> = {
  // Claude (Anthropic)
  'opus': 'anthropic/claude-opus-4.5',
  'sonnet': 'anthropic/claude-sonnet-4.5',
  'haiku': 'anthropic/claude-haiku-4.5',
  'claude': 'anthropic/claude-sonnet-4.5',

  // GPT (OpenAI)
  'gpt': 'openai/gpt-4o',
  'gpt-4o': 'openai/gpt-4o',
  'gpt-4o-mini': 'openai/gpt-4o-mini',
  '4o': 'openai/gpt-4o',
  'o1': 'openai/o1',
  'o3': 'openai/o3',
  'o3-mini': 'openai/o3-mini',
  'o4-mini': 'openai/o4-mini',

  // Gemini (Google)
  'gemini': 'google/gemini-2.5-flash',
  'flash': 'google/gemini-2.5-flash',
  'gemini-flash': 'google/gemini-2.5-flash',
  'gemini-pro': 'google/gemini-2.5-pro',

  // Llama (Meta)
  'llama': 'meta-llama/llama-4-maverick',
  'llama-4': 'meta-llama/llama-4-maverick',
  'llama-70b': 'meta-llama/llama-3.3-70b-instruct',

  // DeepSeek
  'deepseek': 'deepseek/deepseek-chat',
  'r1': 'deepseek/deepseek-r1',

  // Mistral
  'mistral': 'mistralai/mistral-large-2411',
  'codestral': 'mistralai/codestral-2501',

  // Qwen
  'qwen': 'qwen/qwen3-235b-a22b',

  // Grok
  'grok': 'x-ai/grok-3',

  // Perplexity
  'sonar': 'perplexity/sonar-pro',
}

// Models are loaded statically via import
const models: ModelInfo[] = modelsData as ModelInfo[]

function loadModels(): ModelInfo[] {
  return models
}

/**
 * List all available models with pricing from OpenRouter
 */
export function list(): ModelInfo[] {
  return loadModels()
}

/**
 * Get a model by exact ID (e.g., "anthropic/claude-opus-4.5")
 */
export function get(id: string): ModelInfo | undefined {
  return loadModels().find(m => m.id === id)
}

/**
 * Search models by query string (searches in id and name)
 */
export function search(query: string): ModelInfo[] {
  const q = query.toLowerCase()
  return loadModels().filter(m =>
    m.id.toLowerCase().includes(q) ||
    m.name.toLowerCase().includes(q)
  )
}

/**
 * Resolve a model alias or partial name to a full model ID
 *
 * Resolution order:
 * 1. Check aliases (e.g., 'opus' -> 'anthropic/claude-opus-4.5')
 * 2. Check if it's already a full ID (contains '/')
 * 3. Search for first matching model
 */
export function resolve(input: string): string {
  const normalized = input.toLowerCase().trim()

  // Check aliases first
  if (ALIASES[normalized]) {
    return ALIASES[normalized]
  }

  // Already a full ID with provider prefix
  if (input.includes('/')) {
    const model = get(input)
    return model?.id || input
  }

  // Search for matching model
  const matches = search(normalized)
  const firstMatch = matches[0]
  if (firstMatch) {
    return firstMatch.id
  }

  // Return as-is if nothing found
  return input
}

/**
 * Providers that support direct SDK access (not via OpenRouter)
 */
export const DIRECT_PROVIDERS = ['openai', 'anthropic', 'google'] as const
export type DirectProvider = typeof DIRECT_PROVIDERS[number]

/**
 * Result of resolving a model with provider routing info
 */
export interface ResolvedModel {
  /** OpenRouter-style model ID */
  id: string
  /** Provider slug */
  provider: string
  /** Provider's native model ID */
  providerModelId?: string
  /** Whether this provider supports direct SDK routing */
  supportsDirectRouting: boolean
  /** Full model info if available */
  model?: ModelInfo
}

/**
 * Resolve a model alias and get full routing information
 */
export function resolveWithProvider(input: string): ResolvedModel {
  const id = resolve(input)
  const model = get(id)

  const slashIndex = id.indexOf('/')
  const provider = slashIndex > 0 ? id.substring(0, slashIndex) : 'unknown'

  const supportsDirectRouting = (DIRECT_PROVIDERS as readonly string[]).includes(provider)

  return {
    id,
    provider,
    providerModelId: model?.provider_model_id,
    supportsDirectRouting,
    model
  }
}

/**
 * Convert OpenRouter per-token pricing to per-1k-tokens
 */
export function perTokenToPerKTokens(perToken: string): number {
  return parseFloat(perToken) * 1000
}

/**
 * Get pricing for a model in per-1k-tokens format
 */
export function getPricing(modelId: string): { promptPer1k: number; completionPer1k: number } | undefined {
  const model = get(modelId)
  if (!model?.pricing) return undefined

  return {
    promptPer1k: perTokenToPerKTokens(model.pricing.prompt),
    completionPer1k: perTokenToPerKTokens(model.pricing.completion)
  }
}
