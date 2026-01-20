/**
 * @dotdo/ai - Multi-Provider Router
 *
 * Implements intelligent routing across LLM providers (OpenAI, Anthropic, Google, Cloudflare)
 * with support for automatic fallback, cost optimization, load balancing, and health tracking.
 *
 * @module @dotdo/ai/router
 */

import type { Provider, Capability, LoadBalancingStrategy } from './types'

// Re-export core types for backward compatibility
export type { Provider, Capability, LoadBalancingStrategy } from './types'

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
  /** Pricing tier for cost optimization */
  tier?: 'budget' | 'standard' | 'premium'
  /** Human-readable display name */
  displayName?: string
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
  provider?: Provider
  retries?: number
  cost?: number
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

// Model catalog with cost and capability info
// Pricing as of January 2026 - costs are per 1K tokens (average of input/output)
const MODEL_CATALOG: Record<string, ModelInfo> = {
  // ==========================================================================
  // OpenAI Models
  // ==========================================================================

  // GPT-4o - Flagship multimodal model
  'gpt-4o': {
    provider: 'openai',
    model: 'gpt-4o',
    costPer1kTokens: 0.005,
    maxTokens: 128000,
    speed: 'fast',
    tier: 'standard',
    displayName: 'GPT-4o',
  },
  'gpt-4o-mini': {
    provider: 'openai',
    model: 'gpt-4o-mini',
    costPer1kTokens: 0.00015,
    maxTokens: 128000,
    speed: 'fast',
    tier: 'budget',
    displayName: 'GPT-4o Mini',
  },

  // GPT-4 Turbo - High capability
  'gpt-4-turbo': {
    provider: 'openai',
    model: 'gpt-4-turbo',
    costPer1kTokens: 0.01,
    maxTokens: 128000,
    speed: 'fast',
    tier: 'standard',
    displayName: 'GPT-4 Turbo',
  },

  // GPT-4 - Original
  'gpt-4': {
    provider: 'openai',
    model: 'gpt-4',
    costPer1kTokens: 0.03,
    maxTokens: 8192,
    speed: 'medium',
    tier: 'premium',
    displayName: 'GPT-4',
  },

  // GPT-3.5 Turbo - Legacy fast model
  'gpt-3.5-turbo': {
    provider: 'openai',
    model: 'gpt-3.5-turbo',
    costPer1kTokens: 0.0005,
    maxTokens: 16385,
    speed: 'fast',
    tier: 'budget',
    displayName: 'GPT-3.5 Turbo',
  },

  // o1 Reasoning Models
  'o1': {
    provider: 'openai',
    model: 'o1',
    costPer1kTokens: 0.015,
    maxTokens: 200000,
    speed: 'slow',
    tier: 'premium',
    displayName: 'o1',
  },
  'o1-mini': {
    provider: 'openai',
    model: 'o1-mini',
    costPer1kTokens: 0.003,
    maxTokens: 128000,
    speed: 'medium',
    tier: 'standard',
    displayName: 'o1-mini',
  },
  'o3-mini': {
    provider: 'openai',
    model: 'o3-mini',
    costPer1kTokens: 0.0011,
    maxTokens: 200000,
    speed: 'fast',
    tier: 'budget',
    displayName: 'o3-mini',
  },

  // ==========================================================================
  // Anthropic Models
  // ==========================================================================

  // Claude Opus 4.5 - Most capable
  'claude-opus-4-5-20251101': {
    provider: 'anthropic',
    model: 'claude-opus-4-5-20251101',
    costPer1kTokens: 0.015,
    maxTokens: 200000,
    speed: 'medium',
    tier: 'premium',
    displayName: 'Claude Opus 4.5',
  },

  // Claude Sonnet 4 - Balanced performance
  'claude-sonnet-4-20250514': {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    costPer1kTokens: 0.003,
    maxTokens: 200000,
    speed: 'fast',
    tier: 'standard',
    displayName: 'Claude Sonnet 4',
  },

  // Claude 3.5 Sonnet - Previous generation
  'claude-3-5-sonnet-20241022': {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    costPer1kTokens: 0.003,
    maxTokens: 200000,
    speed: 'fast',
    tier: 'standard',
    displayName: 'Claude 3.5 Sonnet',
  },

  // Claude 3.5 Haiku - Fast and efficient
  'claude-3-5-haiku-20241022': {
    provider: 'anthropic',
    model: 'claude-3-5-haiku-20241022',
    costPer1kTokens: 0.0008,
    maxTokens: 200000,
    speed: 'fast',
    tier: 'budget',
    displayName: 'Claude 3.5 Haiku',
  },

  // Legacy Claude 3 models (still supported)
  'claude-3-opus': {
    provider: 'anthropic',
    model: 'claude-3-opus-20240229',
    costPer1kTokens: 0.015,
    maxTokens: 200000,
    speed: 'medium',
    tier: 'premium',
    displayName: 'Claude 3 Opus',
  },
  'claude-3-sonnet': {
    provider: 'anthropic',
    model: 'claude-3-sonnet-20240229',
    costPer1kTokens: 0.003,
    maxTokens: 200000,
    speed: 'fast',
    tier: 'standard',
    displayName: 'Claude 3 Sonnet',
  },
  'claude-3-haiku': {
    provider: 'anthropic',
    model: 'claude-3-haiku-20240307',
    costPer1kTokens: 0.00025,
    maxTokens: 200000,
    speed: 'fast',
    tier: 'budget',
    displayName: 'Claude 3 Haiku',
  },

  // ==========================================================================
  // Google Models
  // ==========================================================================

  // Gemini 2.0 Flash - Latest fast model
  'gemini-2.0-flash': {
    provider: 'google',
    model: 'gemini-2.0-flash',
    costPer1kTokens: 0.0001,
    maxTokens: 1048576,
    speed: 'fast',
    tier: 'budget',
    displayName: 'Gemini 2.0 Flash',
  },

  // Gemini 2.0 Flash Thinking - Reasoning variant
  'gemini-2.0-flash-thinking-exp': {
    provider: 'google',
    model: 'gemini-2.0-flash-thinking-exp',
    costPer1kTokens: 0.0001,
    maxTokens: 1048576,
    speed: 'medium',
    tier: 'budget',
    displayName: 'Gemini 2.0 Flash Thinking',
  },

  // Gemini 1.5 Pro - High capability
  'gemini-1.5-pro': {
    provider: 'google',
    model: 'gemini-1.5-pro',
    costPer1kTokens: 0.00125,
    maxTokens: 2097152,
    speed: 'medium',
    tier: 'standard',
    displayName: 'Gemini 1.5 Pro',
  },

  // Gemini 1.5 Flash - Fast variant
  'gemini-1.5-flash': {
    provider: 'google',
    model: 'gemini-1.5-flash',
    costPer1kTokens: 0.000075,
    maxTokens: 1048576,
    speed: 'fast',
    tier: 'budget',
    displayName: 'Gemini 1.5 Flash',
  },

  // Legacy Gemini Pro (aliased to 1.5)
  'gemini-pro': {
    provider: 'google',
    model: 'gemini-1.5-pro',
    costPer1kTokens: 0.00125,
    maxTokens: 2097152,
    speed: 'medium',
    tier: 'standard',
    displayName: 'Gemini Pro',
  },

  // Gemini Ultra (deprecated, maps to 1.5 Pro)
  'gemini-ultra': {
    provider: 'google',
    model: 'gemini-1.5-pro',
    costPer1kTokens: 0.00125,
    maxTokens: 2097152,
    speed: 'medium',
    tier: 'premium',
    displayName: 'Gemini Ultra',
  },

  // ==========================================================================
  // Cloudflare Workers AI Models
  // ==========================================================================

  // Llama 3.1 - Latest open source
  '@cf/meta/llama-3.1-8b-instruct': {
    provider: 'cloudflare',
    model: '@cf/meta/llama-3.1-8b-instruct',
    costPer1kTokens: 0.0001,
    maxTokens: 128000,
    speed: 'fast',
    tier: 'budget',
    displayName: 'Llama 3.1 8B',
  },

  // Legacy Llama 2 (still supported)
  '@cf/meta/llama-2-7b-chat-int8': {
    provider: 'cloudflare',
    model: '@cf/meta/llama-2-7b-chat-int8',
    costPer1kTokens: 0.0001,
    maxTokens: 4096,
    speed: 'fast',
    tier: 'budget',
    displayName: 'Llama 2 7B',
  },
}

// Capability-based model selection - updated for latest models
const CAPABILITY_MODELS: Record<Capability, string> = {
  fast: 'claude-3-5-haiku-20241022',
  smart: 'claude-opus-4-5-20251101',
  cheap: 'gemini-2.0-flash',
}

/**
 * Multi-provider AI router with intelligent routing, fallback, and load balancing.
 *
 * The Router handles provider selection, health tracking, automatic retries with
 * exponential backoff, and cost-based model selection.
 *
 * @example
 * ```typescript
 * import { Router } from '@dotdo/ai'
 *
 * // Create router with custom providers
 * const router = new Router({
 *   providers: [
 *     { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
 *     { provider: 'openai', apiKey: process.env.OPENAI_API_KEY }
 *   ],
 *   fallback: ['anthropic', 'openai'],
 *   maxRetries: 3,
 *   loadBalancing: 'round-robin'
 * })
 *
 * // Execute with automatic fallback
 * const result = await router.execute('Explain quantum computing', {
 *   model: 'claude-sonnet-4-20250514'
 * })
 *
 * // Select by capability
 * const fastModel = router.selectByCapability('fast')
 * const smartModel = router.selectByCapability('smart')
 * const cheapModel = router.selectByCapability('cheap')
 *
 * // Select optimal model for task with cost constraints
 * const model = router.selectModel({
 *   task: 'summarization',
 *   tokens: 5000
 * })
 * ```
 */
export class Router {
  private config: RouterConfig
  private providerConfigs: Map<Provider, ProviderConfig>
  private currentProviderIndex: number = 0
  private healthStatus: Map<Provider, ProviderHealth>
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
      })
    } else {
      // Initialize default providers
      Object.values(providers).forEach(provider => {
        this.healthStatus.set(provider, {
          healthy: true,
          lastCheck: Date.now(),
          consecutiveFailures: 0
        })
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

  // Internal methods

  private async _executeWithProvider(
    prompt: string,
    options: ExecuteOptions
  ): Promise<ExecuteResult> {
    if (this.executor) {
      return this.executor(prompt, options)
    }

    // Default implementation (placeholder)
    // Real implementation would call actual provider APIs
    const result: ExecuteResult = {
      result: `Response from ${options.provider}: ${prompt}`,
    }
    if (options.provider !== undefined) {
      result.provider = options.provider
    }
    return result
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
        // TODO: Implement least-loaded strategy
        selectedProvider = healthyProviders[0]
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
 * Configure global providers and create a new Router instance.
 *
 * This is a convenience function for quick setup. For more control,
 * create a Router instance directly with new Router(config).
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
 *   { provider: 'openai', apiKey: process.env.OPENAI_API_KEY }
 * ])
 *
 * const result = await router.execute('Hello, world!')
 * ```
 */
export function configureProviders(configs: ProviderConfig[]): Router {
  return new Router({ providers: configs })
}
