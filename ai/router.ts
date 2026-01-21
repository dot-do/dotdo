// Multi-provider routing for @dotdo/ai
// Implements intelligent routing across LLM providers with fallback, cost optimization, and load balancing
//
// PRICING: Model pricing is sourced from OpenRouter via the language-models package.
// This ensures accurate, up-to-date pricing for cost optimization routing.

import {
  get as getLanguageModel,
  perTokenToPerKTokens,
} from './language-models'

export type Provider = 'openai' | 'anthropic' | 'google' | 'cloudflare'
export type Capability = 'fast' | 'smart' | 'cheap'
export type LoadBalancingStrategy = 'round-robin' | 'random' | 'least-loaded'

export interface ProviderConfig {
  provider: Provider
  apiKey?: string
  model?: string
}

export interface ModelInfo {
  provider: Provider
  model: string
  costPer1kTokens: number
  maxTokens: number
  speed: 'fast' | 'medium' | 'slow'
}

export interface RouterConfig {
  providers?: ProviderConfig[]
  fallback?: Provider[]
  maxCostPerRequest?: number
  maxRetries?: number
  loadBalancing?: LoadBalancingStrategy
}

export interface ExecuteOptions {
  model?: string
  provider?: Provider
  temperature?: number
  maxTokens?: number
}

export interface ExecuteResult {
  result: string
  provider?: Provider | undefined
  retries?: number | undefined
  cost?: number | undefined
}

interface ProviderHealth {
  healthy: boolean
  lastCheck: number
  consecutiveFailures: number
}

// Provider registry with model mappings
export const providers = {
  openai: 'openai' as const,
  anthropic: 'anthropic' as const,
  google: 'google' as const,
  cloudflare: 'cloudflare' as const,
}

/**
 * Model catalog with cost and capability information.
 *
 * PRICING SOURCE: OpenRouter via language-models package
 * Pricing is automatically updated from OpenRouter's API data.
 * See: primitives/packages/language-models/data/models.json
 *
 * Router ID mappings to OpenRouter IDs:
 * - 'claude-opus-4-5' -> 'anthropic/claude-opus-4.5'
 * - 'gpt-4o' -> 'openai/gpt-4o'
 * - 'gemini-1.5-flash' -> 'google/gemini-1.5-flash'
 */

// Map Router model IDs to OpenRouter model IDs
const ROUTER_TO_OPENROUTER_ID: Record<string, string> = {
  // OpenAI
  'gpt-4o': 'openai/gpt-4o',
  'gpt-4o-mini': 'openai/gpt-4o-mini',
  'gpt-4': 'openai/gpt-4',
  'gpt-4-turbo': 'openai/gpt-4-turbo',
  'gpt-3.5-turbo': 'openai/gpt-3.5-turbo',
  // Anthropic
  'claude-opus-4-5': 'anthropic/claude-opus-4.5',
  'claude-sonnet-4-5': 'anthropic/claude-sonnet-4.5',
  'claude-3.5-sonnet': 'anthropic/claude-3.5-sonnet',
  'claude-3-sonnet': 'anthropic/claude-3-sonnet-20240229',
  'claude-3.5-haiku': 'anthropic/claude-3.5-haiku',
  'claude-3-opus': 'anthropic/claude-3-opus',
  'claude-3-haiku': 'anthropic/claude-3-haiku',
  // Google
  'gemini-2.0-flash': 'google/gemini-2.0-flash-exp',
  'gemini-1.5-pro': 'google/gemini-1.5-pro',
  'gemini-1.5-flash': 'google/gemini-1.5-flash',
  'gemini-pro': 'google/gemini-pro',
}

// Provider model ID mappings (Router model -> provider's native model ID)
const PROVIDER_MODEL_IDS: Record<string, string> = {
  'claude-opus-4-5': 'claude-opus-4-5-20251101',
  'claude-sonnet-4-5': 'claude-sonnet-4-5-20250929',
  'claude-3.5-sonnet': 'claude-3-5-sonnet-20241022',
  'claude-3-sonnet': 'claude-3-sonnet-20240229',
  'claude-3.5-haiku': 'claude-3-5-haiku-20241022',
  'claude-3-opus': 'claude-3-opus-20240229',
  'claude-3-haiku': 'claude-3-haiku-20240307',
  'gemini-2.0-flash': 'gemini-2.0-flash-exp',
}

// Speed classification based on model characteristics
const MODEL_SPEEDS: Record<string, 'fast' | 'medium' | 'slow'> = {
  // Fast models (smaller, optimized for speed)
  'gpt-4o': 'fast',
  'gpt-4o-mini': 'fast',
  'gpt-4-turbo': 'fast',
  'gpt-3.5-turbo': 'fast',
  'claude-sonnet-4-5': 'fast',
  'claude-3.5-sonnet': 'fast',
  'claude-3.5-haiku': 'fast',
  'claude-3-haiku': 'fast',
  'gemini-2.0-flash': 'fast',
  'gemini-1.5-flash': 'fast',
  'gemini-pro': 'fast',
  '@cf/meta/llama-3.1-8b-instruct': 'fast',
  '@cf/meta/llama-2-7b-chat-int8': 'fast',
  // Medium models (balanced)
  'gpt-4': 'medium',
  'claude-opus-4-5': 'medium',
  'claude-3-opus': 'medium',
  'claude-3-sonnet': 'fast',
  'gemini-1.5-pro': 'medium',
  'gemini-ultra': 'medium',
}

// Fallback pricing for models not in OpenRouter (per 1K tokens)
const FALLBACK_PRICING: Record<string, number> = {
  'gemini-ultra': 0.005,
  '@cf/meta/llama-3.1-8b-instruct': 0.0001,
  '@cf/meta/llama-2-7b-chat-int8': 0.0001,
}

// Fallback max tokens for models not in OpenRouter
const FALLBACK_MAX_TOKENS: Record<string, number> = {
  'gemini-ultra': 32000,
  '@cf/meta/llama-3.1-8b-instruct': 8192,
  '@cf/meta/llama-2-7b-chat-int8': 4096,
}

/**
 * Get pricing for a Router model ID from language-models (OpenRouter data)
 */
function getPricingFromLanguageModels(routerModelId: string): number {
  const openRouterId = ROUTER_TO_OPENROUTER_ID[routerModelId]
  if (openRouterId) {
    const lmModel = getLanguageModel(openRouterId)
    if (lmModel?.pricing?.prompt) {
      return perTokenToPerKTokens(lmModel.pricing.prompt)
    }
  }
  // Fallback for models not in OpenRouter
  return FALLBACK_PRICING[routerModelId] ?? 0.001
}

/**
 * Get max tokens for a Router model ID from language-models (OpenRouter data)
 */
function getMaxTokensFromLanguageModels(routerModelId: string): number {
  const openRouterId = ROUTER_TO_OPENROUTER_ID[routerModelId]
  if (openRouterId) {
    const lmModel = getLanguageModel(openRouterId)
    if (lmModel?.context_length) {
      return lmModel.context_length
    }
  }
  // Fallback
  return FALLBACK_MAX_TOKENS[routerModelId] ?? 128000
}

/**
 * Build model info from language-models data
 */
function buildModelInfo(routerModelId: string, provider: Provider): ModelInfo {
  return {
    provider,
    model: PROVIDER_MODEL_IDS[routerModelId] ?? routerModelId,
    costPer1kTokens: getPricingFromLanguageModels(routerModelId),
    maxTokens: getMaxTokensFromLanguageModels(routerModelId),
    speed: MODEL_SPEEDS[routerModelId] ?? 'fast'
  }
}

// Build MODEL_CATALOG dynamically from language-models data
const MODEL_CATALOG: Record<string, ModelInfo> = {
  // OpenAI models
  'gpt-4o': buildModelInfo('gpt-4o', 'openai'),
  'gpt-4o-mini': buildModelInfo('gpt-4o-mini', 'openai'),
  'gpt-4': buildModelInfo('gpt-4', 'openai'),
  'gpt-4-turbo': buildModelInfo('gpt-4-turbo', 'openai'),
  'gpt-3.5-turbo': buildModelInfo('gpt-3.5-turbo', 'openai'),

  // Anthropic models
  'claude-opus-4-5': buildModelInfo('claude-opus-4-5', 'anthropic'),
  'claude-sonnet-4-5': buildModelInfo('claude-sonnet-4-5', 'anthropic'),
  'claude-3.5-sonnet': buildModelInfo('claude-3.5-sonnet', 'anthropic'),
  'claude-3-sonnet': buildModelInfo('claude-3-sonnet', 'anthropic'),
  'claude-3.5-haiku': buildModelInfo('claude-3.5-haiku', 'anthropic'),
  'claude-3-opus': buildModelInfo('claude-3-opus', 'anthropic'),
  'claude-3-haiku': buildModelInfo('claude-3-haiku', 'anthropic'),

  // Google models
  'gemini-2.0-flash': buildModelInfo('gemini-2.0-flash', 'google'),
  'gemini-1.5-pro': buildModelInfo('gemini-1.5-pro', 'google'),
  'gemini-1.5-flash': buildModelInfo('gemini-1.5-flash', 'google'),
  'gemini-pro': buildModelInfo('gemini-pro', 'google'),
  'gemini-ultra': buildModelInfo('gemini-ultra', 'google'),

  // Cloudflare Workers AI
  '@cf/meta/llama-3.1-8b-instruct': buildModelInfo('@cf/meta/llama-3.1-8b-instruct', 'cloudflare'),
  '@cf/meta/llama-2-7b-chat-int8': buildModelInfo('@cf/meta/llama-2-7b-chat-int8', 'cloudflare'),
}

// Capability-based model selection
const CAPABILITY_MODELS: Record<Capability, string> = {
  fast: 'claude-3.5-haiku',
  smart: 'claude-opus-4-5',
  cheap: 'gemini-1.5-flash'
}

/**
 * AI Router with health tracking and load balancing.
 *
 * IMPORTANT: Health state is INTENTIONALLY instance-level, not request-scoped.
 *
 * Why instance-level health tracking?
 * - Circuit breaker pattern requires persistent health state across requests
 * - Prevents repeatedly hitting providers that are known to be unhealthy
 * - Load balancing (least-loaded) requires tracking active requests globally
 * - Router is designed as a long-lived singleton service, not per-request
 *
 * Usage:
 * ```typescript
 * // Create once at startup
 * const router = new Router({
 *   providers: [...],
 *   loadBalancing: 'least-loaded'
 * })
 *
 * // Reuse across requests
 * const result1 = await router.execute('prompt1')
 * const result2 = await router.execute('prompt2') // Shares health state
 * ```
 *
 * If you need request-scoped routing, create a new Router instance per request.
 *
 * Reviewed: do-ghnx - Instance-level health state is intentional and correct.
 */
export class Router {
  private config: RouterConfig
  private providerConfigs: Map<Provider, ProviderConfig>
  private currentProviderIndex: number = 0
  private healthStatus: Map<Provider, ProviderHealth>  // Instance-level for circuit breaker
  private activeRequests: Map<Provider, number> = new Map()  // Instance-level for load balancing
  private executor?: (prompt: string, options: ExecuteOptions) => Promise<ExecuteResult>
  private delayCallback?: (delay: number) => void

  constructor(config: RouterConfig = {}) {
    this.config = {
      maxRetries: 3,
      loadBalancing: 'round-robin',
      ...config
    }

    this.providerConfigs = new Map()
    this.healthStatus = new Map()

    // Initialize provider configs
    if (config.providers) {
      config.providers.forEach(pc => {
        this.providerConfigs.set(pc.provider, pc)
        this.healthStatus.set(pc.provider, {
          healthy: true,
          lastCheck: Date.now(),
          consecutiveFailures: 0
        })
        this.activeRequests.set(pc.provider, 0)
      })
    } else {
      // Initialize default providers
      Object.values(providers).forEach(provider => {
        this.healthStatus.set(provider, {
          healthy: true,
          lastCheck: Date.now(),
          consecutiveFailures: 0
        })
        this.activeRequests.set(provider, 0)
      })
    }
  }

  /**
   * Resolve provider from model name
   */
  resolve(model: string): Provider {
    const modelInfo = MODEL_CATALOG[model]
    if (!modelInfo) {
      throw new Error(`Unknown model: ${model}`)
    }
    return modelInfo.provider
  }

  /**
   * Select model by capability (fast, smart, cheap)
   */
  selectByCapability(capability: Capability): ModelInfo {
    const modelName = CAPABILITY_MODELS[capability]
    const modelInfo = MODEL_CATALOG[modelName]
    if (!modelInfo) {
      throw new Error(`No model found for capability: ${capability}`)
    }
    return modelInfo
  }

  /**
   * Select optimal model based on task and constraints
   */
  selectModel(options: { task: string; tokens: number }): ModelInfo {
    const { tokens } = options
    const maxCost = this.config.maxCostPerRequest

    // Filter models that meet cost constraints
    const eligibleModels = Object.values(MODEL_CATALOG).filter(model => {
      if (!maxCost) return true

      const estimatedCost = (tokens / 1000) * model.costPer1kTokens
      return estimatedCost <= maxCost
    })

    if (eligibleModels.length === 0) {
      throw new Error('No model meets cost constraints')
    }

    // Sort by cost (cheapest first)
    eligibleModels.sort((a, b) => a.costPer1kTokens - b.costPer1kTokens)

    const cheapestModel = eligibleModels[0]
    if (!cheapestModel) {
      throw new Error('No model meets cost constraints')
    }
    return cheapestModel
  }

  /**
   * Execute prompt with automatic fallback and retry
   */
  async execute(prompt: string, options: ExecuteOptions = {}): Promise<ExecuteResult> {
    // If load balancing is configured and no specific provider requested, use load balancing
    // In this mode, we only try the selected provider (no fallback chain)
    if (this.config.loadBalancing && !options.provider && this.providerConfigs.size > 0) {
      const provider = this._selectProviderForLoadBalancing()
      const maxRetries = this.config.maxRetries || 3
      let totalRetries = 0

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const result = await this._executeWithProvider(prompt, {
            ...options,
            provider
          })

          this._markHealthy(provider)

          const executeResult: ExecuteResult = {
            ...result,
            provider
          }
          if (totalRetries > 0) {
            executeResult.retries = totalRetries
          }
          return executeResult
        } catch (error) {
          totalRetries++

          if (this._isRateLimitError(error as Error)) {
            if (totalRetries >= maxRetries) {
              throw new Error('Max retries exceeded')
            }

            const delay = Math.pow(2, attempt) * 1000
            if (this.delayCallback) {
              this.delayCallback(delay)
            }
            await this._sleep(delay)
            continue
          }

          throw error
        }
      }
    }

    // Fallback chain mode
    const fallbackChain = this.config.fallback || ['anthropic', 'openai', 'google']
    const maxRetries = this.config.maxRetries || 3

    let lastError: Error | null = null
    let totalRetries = 0

    // Try each provider in fallback chain
    for (const provider of fallbackChain) {
      // Skip unhealthy providers
      const health = this.healthStatus.get(provider)
      if (health && !health.healthy) {
        continue
      }

      // Try with retries for rate limits
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const result = await this._executeWithProvider(prompt, {
            ...options,
            provider
          })

          // Mark provider as healthy
          this._markHealthy(provider)

          const executeResult: ExecuteResult = {
            ...result,
            provider
          }
          if (totalRetries > 0) {
            executeResult.retries = totalRetries
          }
          return executeResult
        } catch (error) {
          lastError = error as Error
          totalRetries++

          // Check if it's a rate limit error
          if (this._isRateLimitError(error as Error)) {
            // Check if we've exceeded max retries across all providers
            if (totalRetries >= maxRetries) {
              throw new Error('Max retries exceeded')
            }

            // Exponential backoff
            const delay = Math.pow(2, attempt) * 1000
            if (this.delayCallback) {
              this.delayCallback(delay)
            }
            await this._sleep(delay)
            continue
          }

          // Other errors, try next provider
          this._markUnhealthy(provider)
          break
        }
      }
    }

    throw new Error(`All providers failed: ${lastError?.message}`)
  }

  /**
   * Get list of configured providers
   */
  getProviders(): ProviderConfig[] {
    return Array.from(this.providerConfigs.values())
  }

  /**
   * Get health status of all providers
   */
  getHealth(): Record<Provider, ProviderHealth | undefined> {
    const health: Record<string, ProviderHealth | undefined> = {}
    Object.values(providers).forEach(provider => {
      health[provider] = this.healthStatus.get(provider)
    })
    return health as Record<Provider, ProviderHealth | undefined>
  }

  /**
   * Get active request counts for all providers (used by least-loaded strategy)
   */
  getActiveRequests(): Record<Provider, number> {
    const counts: Record<string, number> = {}
    Object.values(providers).forEach(provider => {
      counts[provider] = this.activeRequests.get(provider) || 0
    })
    return counts as Record<Provider, number>
  }

  // Internal methods

  private async _executeWithProvider(
    prompt: string,
    options: ExecuteOptions
  ): Promise<ExecuteResult> {
    const provider = options.provider

    // Track active request for least-loaded load balancing
    if (provider) {
      const current = this.activeRequests.get(provider) || 0
      this.activeRequests.set(provider, current + 1)
    }

    try {
      if (this.executor) {
        return await this.executor(prompt, options)
      }

      // Default implementation (placeholder)
      // Real implementation would call actual provider APIs
      return {
        result: `Response from ${options.provider}: ${prompt}`,
        provider: options.provider
      }
    } finally {
      // Decrement active request counter
      if (provider) {
        const current = this.activeRequests.get(provider) || 0
        this.activeRequests.set(provider, Math.max(0, current - 1))
      }
    }
  }

  private _selectProviderForLoadBalancing(): Provider {
    const healthyProviders = Array.from(this.providerConfigs.keys()).filter(provider => {
      const health = this.healthStatus.get(provider)
      return !health || health.healthy
    })

    if (healthyProviders.length === 0) {
      throw new Error('No healthy providers available')
    }

    let selectedProvider: Provider | undefined

    switch (this.config.loadBalancing) {
      case 'round-robin':
        selectedProvider = healthyProviders[this.currentProviderIndex % healthyProviders.length]
        this.currentProviderIndex++
        break

      case 'random':
        selectedProvider = healthyProviders[Math.floor(Math.random() * healthyProviders.length)]
        break

      case 'least-loaded':
        // Select provider with fewest active requests
        selectedProvider = healthyProviders.reduce((least, current) => {
          const leastLoad = this.activeRequests.get(least) || 0
          const currentLoad = this.activeRequests.get(current) || 0
          return currentLoad < leastLoad ? current : least
        })
        break

      default:
        selectedProvider = healthyProviders[0]
    }

    if (!selectedProvider) {
      throw new Error('No healthy providers available')
    }
    return selectedProvider
  }

  private _isRateLimitError(error: Error): boolean {
    return error.message.includes('Rate limit') || error.message.includes('rate limit')
  }

  private _markHealthy(provider: Provider): void {
    this.healthStatus.set(provider, {
      healthy: true,
      lastCheck: Date.now(),
      consecutiveFailures: 0
    })
  }

  _markUnhealthy(provider: Provider): void {
    const current = this.healthStatus.get(provider)
    this.healthStatus.set(provider, {
      healthy: false,
      lastCheck: Date.now(),
      consecutiveFailures: (current?.consecutiveFailures || 0) + 1
    })
  }

  private async _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // Test helper methods (prefixed with _ to indicate internal/test use)

  _setExecutor(executor: (prompt: string, options: ExecuteOptions) => Promise<ExecuteResult>): void {
    this.executor = executor
  }

  _onDelay(callback: (delay: number) => void): void {
    this.delayCallback = callback
  }
}

/**
 * Configures and returns an AI Router with the specified providers.
 *
 * This is a convenience function for creating a Router with provider
 * configurations. Use this when you want to set up multiple providers
 * with their API keys and settings.
 *
 * @param configs - Array of provider configurations with API keys
 * @returns A configured Router instance
 *
 * @example
 * ```typescript
 * import { configureProviders } from '@dotdo/ai'
 *
 * const router = configureProviders([
 *   { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
 *   { provider: 'openai', apiKey: process.env.OPENAI_API_KEY },
 *   { provider: 'google', apiKey: process.env.GOOGLE_API_KEY }
 * ])
 *
 * const result = await router.execute('Generate a haiku about code')
 * ```
 *
 * @stable
 * @since 1.0.0
 */
export function configureProviders(configs: ProviderConfig[]): Router {
  return new Router({ providers: configs })
}
