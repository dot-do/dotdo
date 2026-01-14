/**
 * LLM.do - Model Router
 *
 * Intelligent model routing based on:
 * - Model requested
 * - Cost optimization
 * - Latency requirements
 * - Capability matching (vision, function calling, etc.)
 *
 * @module llm/router
 */

import type {
  LLMProvider,
  ModelMapping,
  ModelRoutingCriteria,
  ProviderAdapter,
  LLMEnv,
} from './types'

// ============================================================================
// Model Mappings
// ============================================================================

/**
 * Default model mappings from common model names to provider-specific models
 */
export const MODEL_MAPPINGS: ModelMapping[] = [
  // OpenAI models
  { from: 'gpt-4o', provider: 'openai', to: 'gpt-4o', capabilities: ['vision', 'function_calling', 'streaming', 'json_mode'], costTier: 4, avgLatencyMs: 500 },
  { from: 'gpt-4o-mini', provider: 'openai', to: 'gpt-4o-mini', capabilities: ['vision', 'function_calling', 'streaming', 'json_mode'], costTier: 2, avgLatencyMs: 300 },
  { from: 'gpt-4-turbo', provider: 'openai', to: 'gpt-4-turbo', capabilities: ['vision', 'function_calling', 'streaming', 'json_mode'], costTier: 4, avgLatencyMs: 600 },
  { from: 'gpt-4', provider: 'openai', to: 'gpt-4', capabilities: ['function_calling', 'streaming'], costTier: 5, avgLatencyMs: 800 },
  { from: 'gpt-3.5-turbo', provider: 'openai', to: 'gpt-3.5-turbo', capabilities: ['function_calling', 'streaming', 'json_mode'], costTier: 1, avgLatencyMs: 200 },
  { from: 'o1', provider: 'openai', to: 'o1', capabilities: ['streaming'], costTier: 5, avgLatencyMs: 3000 },
  { from: 'o1-mini', provider: 'openai', to: 'o1-mini', capabilities: ['streaming'], costTier: 3, avgLatencyMs: 2000 },
  { from: 'o1-preview', provider: 'openai', to: 'o1-preview', capabilities: ['streaming'], costTier: 5, avgLatencyMs: 3000 },
  { from: 'o3-mini', provider: 'openai', to: 'o3-mini', capabilities: ['streaming'], costTier: 3, avgLatencyMs: 2000 },

  // Anthropic models
  { from: 'claude-3-5-sonnet-20241022', provider: 'anthropic', to: 'claude-3-5-sonnet-20241022', capabilities: ['vision', 'function_calling', 'streaming'], costTier: 3, avgLatencyMs: 400 },
  { from: 'claude-sonnet-4-20250514', provider: 'anthropic', to: 'claude-sonnet-4-20250514', capabilities: ['vision', 'function_calling', 'streaming'], costTier: 3, avgLatencyMs: 400 },
  { from: 'claude-3-5-haiku-20241022', provider: 'anthropic', to: 'claude-3-5-haiku-20241022', capabilities: ['vision', 'function_calling', 'streaming'], costTier: 1, avgLatencyMs: 200 },
  { from: 'claude-3-opus-20240229', provider: 'anthropic', to: 'claude-3-opus-20240229', capabilities: ['vision', 'function_calling', 'streaming'], costTier: 5, avgLatencyMs: 1000 },
  { from: 'claude-opus-4-20250514', provider: 'anthropic', to: 'claude-opus-4-20250514', capabilities: ['vision', 'function_calling', 'streaming'], costTier: 5, avgLatencyMs: 800 },

  // Short aliases
  { from: 'claude-3-5-sonnet', provider: 'anthropic', to: 'claude-3-5-sonnet-20241022', capabilities: ['vision', 'function_calling', 'streaming'], costTier: 3, avgLatencyMs: 400 },
  { from: 'claude-3-opus', provider: 'anthropic', to: 'claude-3-opus-20240229', capabilities: ['vision', 'function_calling', 'streaming'], costTier: 5, avgLatencyMs: 1000 },
  { from: 'claude-sonnet', provider: 'anthropic', to: 'claude-sonnet-4-20250514', capabilities: ['vision', 'function_calling', 'streaming'], costTier: 3, avgLatencyMs: 400 },
  { from: 'claude-opus', provider: 'anthropic', to: 'claude-opus-4-20250514', capabilities: ['vision', 'function_calling', 'streaming'], costTier: 5, avgLatencyMs: 800 },

  // Google models
  { from: 'gemini-1.5-pro', provider: 'google', to: 'gemini-1.5-pro', capabilities: ['vision', 'function_calling', 'streaming'], costTier: 3, avgLatencyMs: 500 },
  { from: 'gemini-1.5-flash', provider: 'google', to: 'gemini-1.5-flash', capabilities: ['vision', 'function_calling', 'streaming'], costTier: 1, avgLatencyMs: 150 },
  { from: 'gemini-2.0-flash-exp', provider: 'google', to: 'gemini-2.0-flash-exp', capabilities: ['vision', 'function_calling', 'streaming'], costTier: 2, avgLatencyMs: 200 },
  { from: 'gemini-pro', provider: 'google', to: 'gemini-1.5-pro', capabilities: ['vision', 'function_calling', 'streaming'], costTier: 3, avgLatencyMs: 500 },
  { from: 'gemini-flash', provider: 'google', to: 'gemini-1.5-flash', capabilities: ['vision', 'function_calling', 'streaming'], costTier: 1, avgLatencyMs: 150 },

  // Workers AI models
  { from: '@cf/meta/llama-3.1-70b-instruct', provider: 'workers-ai', to: '@cf/meta/llama-3.1-70b-instruct', capabilities: ['streaming'], costTier: 2, avgLatencyMs: 300 },
  { from: '@cf/meta/llama-3.1-8b-instruct', provider: 'workers-ai', to: '@cf/meta/llama-3.1-8b-instruct', capabilities: ['streaming'], costTier: 1, avgLatencyMs: 100 },
  { from: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', provider: 'workers-ai', to: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', capabilities: ['streaming'], costTier: 2, avgLatencyMs: 250 },
  { from: '@cf/mistral/mistral-7b-instruct-v0.2', provider: 'workers-ai', to: '@cf/mistral/mistral-7b-instruct-v0.2', capabilities: ['streaming'], costTier: 1, avgLatencyMs: 80 },
  { from: 'llama-3.1-70b', provider: 'workers-ai', to: '@cf/meta/llama-3.1-70b-instruct', capabilities: ['streaming'], costTier: 2, avgLatencyMs: 300 },
  { from: 'llama-3.1-8b', provider: 'workers-ai', to: '@cf/meta/llama-3.1-8b-instruct', capabilities: ['streaming'], costTier: 1, avgLatencyMs: 100 },

  // Ollama models (local)
  { from: 'llama3.2', provider: 'ollama', to: 'llama3.2', capabilities: ['streaming'], costTier: 0, avgLatencyMs: 200 },
  { from: 'llama3.2:1b', provider: 'ollama', to: 'llama3.2:1b', capabilities: ['streaming'], costTier: 0, avgLatencyMs: 50 },
  { from: 'llama3.2:3b', provider: 'ollama', to: 'llama3.2:3b', capabilities: ['streaming'], costTier: 0, avgLatencyMs: 100 },
  { from: 'mistral', provider: 'ollama', to: 'mistral', capabilities: ['streaming'], costTier: 0, avgLatencyMs: 150 },
  { from: 'mixtral', provider: 'ollama', to: 'mixtral', capabilities: ['streaming'], costTier: 0, avgLatencyMs: 300 },
  { from: 'codellama', provider: 'ollama', to: 'codellama', capabilities: ['streaming'], costTier: 0, avgLatencyMs: 200 },
  { from: 'deepseek-coder', provider: 'ollama', to: 'deepseek-coder', capabilities: ['streaming'], costTier: 0, avgLatencyMs: 250 },
]

/**
 * Model aliases for convenience
 */
export const MODEL_ALIASES: Record<string, string> = {
  // Fast/cheap models
  'fast': 'gpt-4o-mini',
  'cheap': 'gpt-3.5-turbo',
  'haiku': 'claude-3-5-haiku-20241022',
  'flash': 'gemini-1.5-flash',

  // Best models
  'best': 'claude-opus-4-20250514',
  'opus': 'claude-opus-4-20250514',
  'sonnet': 'claude-sonnet-4-20250514',

  // Reasoning models
  'reasoning': 'o1',
  'think': 'o1',

  // Vision models
  'vision': 'gpt-4o',

  // Code models
  'code': 'claude-sonnet-4-20250514',
  'coding': 'claude-sonnet-4-20250514',

  // Local models
  'local': 'llama3.2',
  'offline': 'llama3.2',
}

// ============================================================================
// Router Implementation
// ============================================================================

export interface RouterConfig {
  /** Custom model mappings to add/override */
  customMappings?: ModelMapping[]
  /** Default provider when no mapping found */
  defaultProvider?: LLMProvider
  /** Default model when no mapping found */
  defaultModel?: string
}

export interface RouteResult {
  provider: LLMProvider
  model: string
  originalModel: string
  capabilities: Array<'vision' | 'function_calling' | 'streaming' | 'json_mode'>
  costTier: number
  avgLatencyMs: number
}

/**
 * Model Router - Routes requests to the appropriate provider
 */
export class ModelRouter {
  private mappings: ModelMapping[]
  private mappingIndex: Map<string, ModelMapping>
  private config: RouterConfig

  constructor(config: RouterConfig = {}) {
    this.config = {
      defaultProvider: 'openai',
      defaultModel: 'gpt-4o-mini',
      ...config,
    }

    // Merge default mappings with custom ones
    this.mappings = [...MODEL_MAPPINGS, ...(config.customMappings ?? [])]

    // Build lookup index
    this.mappingIndex = new Map()
    for (const mapping of this.mappings) {
      this.mappingIndex.set(mapping.from.toLowerCase(), mapping)
    }
  }

  /**
   * Resolve a model alias to its full name
   */
  resolveAlias(model: string): string {
    const lowerModel = model.toLowerCase()
    return MODEL_ALIASES[lowerModel] ?? model
  }

  /**
   * Route a model to the appropriate provider
   */
  route(model: string, criteria?: ModelRoutingCriteria): RouteResult {
    // First, resolve any aliases
    const resolvedModel = this.resolveAlias(model)
    const lowerModel = resolvedModel.toLowerCase()

    // Look up in mapping index
    let mapping = this.mappingIndex.get(lowerModel)

    // If not found, check if it's a provider-prefixed model
    if (!mapping) {
      // Check for provider prefix (e.g., "openai/gpt-4" or "anthropic/claude-3")
      const prefixMatch = resolvedModel.match(/^(openai|anthropic|google|workers-ai|ollama)\/(.+)$/i)
      if (prefixMatch) {
        const providerPrefix = prefixMatch[1]
        const modelName = prefixMatch[2]
        if (providerPrefix && modelName) {
          const provider = providerPrefix.toLowerCase() as LLMProvider

          // Look up the model without prefix
          mapping = this.mappingIndex.get(modelName.toLowerCase())

          // If we find it, override the provider
          if (mapping) {
            mapping = { ...mapping, provider }
          } else {
            // Create an ad-hoc mapping for unknown models
            mapping = {
              from: resolvedModel,
              provider,
              to: modelName,
              capabilities: ['streaming'],
              costTier: 3,
              avgLatencyMs: 500,
            }
          }
        }
      }
    }

    // If still not found and we have routing criteria, try to find best match
    if (!mapping && criteria) {
      mapping = this.findBestMatch(criteria)
    }

    // If still not found, use defaults
    if (!mapping) {
      mapping = {
        from: resolvedModel,
        provider: this.config.defaultProvider!,
        to: resolvedModel,
        capabilities: ['streaming'],
        costTier: 3,
        avgLatencyMs: 500,
      }
    }

    // Apply routing criteria preferences
    if (criteria) {
      mapping = this.applyRoutingCriteria(mapping, criteria)
    }

    return {
      provider: mapping.provider,
      model: mapping.to,
      originalModel: model,
      capabilities: mapping.capabilities ?? ['streaming'],
      costTier: mapping.costTier ?? 3,
      avgLatencyMs: mapping.avgLatencyMs ?? 500,
    }
  }

  /**
   * Find the best model match based on criteria
   */
  private findBestMatch(criteria: ModelRoutingCriteria): ModelMapping | undefined {
    let candidates = [...this.mappings]

    // Filter by required capabilities
    if (criteria.capabilities?.length) {
      candidates = candidates.filter((m) =>
        criteria.capabilities!.every((cap) => m.capabilities?.includes(cap))
      )
    }

    // Filter by preferred provider
    if (criteria.preferredProvider) {
      const preferredCandidates = candidates.filter((m) => m.provider === criteria.preferredProvider)
      if (preferredCandidates.length > 0) {
        candidates = preferredCandidates
      }
    }

    // Sort by criteria
    if (criteria.costOptimized) {
      candidates.sort((a, b) => (a.costTier ?? 3) - (b.costTier ?? 3))
    } else if (criteria.lowLatency) {
      candidates.sort((a, b) => (a.avgLatencyMs ?? 500) - (b.avgLatencyMs ?? 500))
    }

    return candidates[0]
  }

  /**
   * Apply routing criteria to modify the selected mapping
   */
  private applyRoutingCriteria(mapping: ModelMapping, criteria: ModelRoutingCriteria): ModelMapping {
    // If cost optimization is requested and there's a cheaper alternative
    if (criteria.costOptimized && mapping.costTier && mapping.costTier > 2) {
      const cheaper = this.mappings.find(
        (m) =>
          m.provider === mapping.provider &&
          m.costTier &&
          m.costTier < mapping.costTier! &&
          (criteria.capabilities ?? []).every((cap) => m.capabilities?.includes(cap))
      )
      if (cheaper) {
        return cheaper
      }
    }

    // If low latency is requested and there's a faster alternative
    if (criteria.lowLatency && mapping.avgLatencyMs && mapping.avgLatencyMs > 300) {
      const faster = this.mappings.find(
        (m) =>
          m.avgLatencyMs &&
          m.avgLatencyMs < mapping.avgLatencyMs! &&
          (criteria.capabilities ?? []).every((cap) => m.capabilities?.includes(cap))
      )
      if (faster) {
        return faster
      }
    }

    return mapping
  }

  /**
   * Check if a provider is available based on environment
   */
  isProviderAvailable(provider: LLMProvider, env: LLMEnv): boolean {
    switch (provider) {
      case 'openai':
        return !!env.OPENAI_API_KEY
      case 'anthropic':
        return !!env.ANTHROPIC_API_KEY
      case 'google':
        return !!env.GOOGLE_API_KEY
      case 'workers-ai':
        return !!env.AI
      case 'ollama':
        return !!env.OLLAMA_BASE_URL
      default:
        return false
    }
  }

  /**
   * Get available providers based on environment
   */
  getAvailableProviders(env: LLMEnv): LLMProvider[] {
    const providers: LLMProvider[] = ['openai', 'anthropic', 'google', 'workers-ai', 'ollama']
    return providers.filter((p) => this.isProviderAvailable(p, env))
  }

  /**
   * Get available models for a provider
   */
  getModelsForProvider(provider: LLMProvider): string[] {
    return this.mappings
      .filter((m) => m.provider === provider)
      .map((m) => m.from)
  }

  /**
   * Get all available models across all providers
   */
  getAllModels(): string[] {
    return Array.from(new Set(this.mappings.map((m) => m.from)))
  }
}

/**
 * Create a default router instance
 */
export function createRouter(config?: RouterConfig): ModelRouter {
  return new ModelRouter(config)
}

/**
 * Default router instance
 */
export const defaultRouter = createRouter()
