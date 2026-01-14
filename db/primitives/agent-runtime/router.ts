/**
 * LLM Router - Multi-provider routing with fallback and load balancing
 *
 * Provides:
 * - Multiple routing strategies (priority, round-robin, least-latency, cost-optimized)
 * - Automatic fallback on provider failure
 * - Rate limiting per provider
 * - Request statistics and cost tracking
 *
 * @module db/primitives/agent-runtime
 */

import type {
  ProviderConfig,
  ProviderName,
  RouterConfig,
  RoutingStrategy,
  CompletionRequest,
  CompletionResponse,
  StreamEvent,
  UsageStats,
  ProviderUsageStats,
  ModelUsageStats,
  LLMProvider,
  ModelConfig,
} from './types'
import {
  createOpenAIProvider,
  createAnthropicProvider,
  createProviderRegistry,
  type ProviderRegistry,
} from './providers'

// ============================================================================
// Router Interface
// ============================================================================

export interface LLMRouter {
  /** Router configuration */
  readonly config: RouterConfig

  /** Get current routing strategy */
  getStrategy(): RoutingStrategy

  /** Complete a request (routes to appropriate provider) */
  complete(request: CompletionRequest): Promise<CompletionResponse>

  /** Stream a request (routes to appropriate provider) */
  stream(request: CompletionRequest): AsyncIterable<StreamEvent>

  /** Get usage statistics */
  getStats(): UsageStats

  /** Reset usage statistics */
  resetStats(): void

  /** Get provider registry */
  getRegistry(): ProviderRegistry
}

// ============================================================================
// Cost Calculation
// ============================================================================

const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  // OpenAI
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  'o1': { input: 0.015, output: 0.06 },
  'o1-mini': { input: 0.003, output: 0.012 },
  // Anthropic
  'claude-opus-4-20250514': { input: 0.015, output: 0.075 },
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
  'claude-3-opus-20240229': { input: 0.015, output: 0.075 },
  'claude-3-haiku-20240307': { input: 0.00025, output: 0.00125 },
}

function calculateCost(model: string, promptTokens: number, completionTokens: number): number {
  const costs = MODEL_COSTS[model]
  if (!costs) return 0
  return (promptTokens / 1000) * costs.input + (completionTokens / 1000) * costs.output
}

// ============================================================================
// Router Implementation
// ============================================================================

class LLMRouterImpl implements LLMRouter {
  readonly config: RouterConfig
  private registry: ProviderRegistry
  private strategy: RoutingStrategy
  private roundRobinIndex = 0
  private stats: UsageStats

  constructor(config: RouterConfig) {
    if (!config.providers || config.providers.length === 0) {
      throw new Error('At least one provider is required')
    }

    this.config = config
    this.strategy = config.strategy ?? 'priority'
    this.registry = createProviderRegistry()
    this.stats = this.createEmptyStats()

    // Initialize providers
    for (const providerConfig of config.providers) {
      const provider = this.createProvider(providerConfig)
      this.registry.register(provider)
    }
  }

  getStrategy(): RoutingStrategy {
    return this.strategy
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const provider = this.selectProvider(request)
    if (!provider) {
      throw new Error(`No provider available for model: ${request.model}`)
    }

    const startTime = performance.now()
    let response: CompletionResponse
    let lastError: Error | undefined

    // Try with fallback if enabled
    const maxAttempts = this.config.fallback?.enabled
      ? (this.config.fallback.maxAttempts ?? 2)
      : 1

    const providers = this.getProvidersForModel(request.model)
    let attemptIndex = 0

    for (let attempt = 0; attempt < maxAttempts && attemptIndex < providers.length; attempt++) {
      const currentProvider = providers[attemptIndex]!
      try {
        response = await currentProvider.complete(request)
        const latencyMs = Math.round(performance.now() - startTime)

        // Update statistics
        this.updateStats(currentProvider!.name, request.model, response, latencyMs)

        return response
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // Check if we should fallback
        if (this.config.fallback?.enabled && this.shouldFallback(lastError)) {
          attemptIndex++
          continue
        }
        throw error
      }
    }

    throw lastError ?? new Error('All providers failed')
  }

  async *stream(request: CompletionRequest): AsyncIterable<StreamEvent> {
    const provider = this.selectProvider(request)
    if (!provider) {
      throw new Error(`No provider available for model: ${request.model}`)
    }

    const startTime = performance.now()

    try {
      for await (const event of provider.stream(request)) {
        yield event

        // Update stats on done event
        if (event.type === 'done') {
          const data = event.data as { response: CompletionResponse }
          const latencyMs = Math.round(performance.now() - startTime)
          this.updateStats(provider.name, request.model, data.response, latencyMs)
        }
      }
    } catch (error) {
      // Could implement fallback for streaming too
      throw error
    }
  }

  getStats(): UsageStats {
    return { ...this.stats }
  }

  resetStats(): void {
    this.stats = this.createEmptyStats()
  }

  getRegistry(): ProviderRegistry {
    return this.registry
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private createProvider(config: ProviderConfig): LLMProvider {
    switch (config.name) {
      case 'openai':
        return createOpenAIProvider({
          apiKey: config.apiKey ?? '',
          baseUrl: config.baseUrl,
          organization: config.organization,
          defaultModel: config.defaultModel,
          timeout: config.timeout,
          headers: config.headers,
          options: config.options as { mockResponse?: CompletionResponse; mockStreamEvents?: StreamEvent[] },
        })
      case 'anthropic':
        return createAnthropicProvider({
          apiKey: config.apiKey ?? '',
          baseUrl: config.baseUrl,
          defaultModel: config.defaultModel,
          timeout: config.timeout,
          headers: config.headers,
          options: config.options as { mockResponse?: CompletionResponse; mockStreamEvents?: StreamEvent[] },
        })
      default:
        throw new Error(`Unsupported provider: ${config.name}`)
    }
  }

  private selectProvider(request: CompletionRequest): LLMProvider | undefined {
    const providers = this.getProvidersForModel(request.model)
    if (providers.length === 0) return undefined

    switch (this.strategy) {
      case 'priority':
        return providers[0]

      case 'round-robin':
        const idx = this.roundRobinIndex % providers.length
        this.roundRobinIndex++
        return providers[idx]

      case 'least-latency':
        return this.selectByLatency(providers)

      case 'cost-optimized':
        return this.selectByCost(providers, request.model)

      case 'custom':
        if (this.config.customRouter) {
          const config = this.config.customRouter(request, this.config.providers)
          return this.registry.get(config.name)
        }
        return providers[0]

      default:
        return providers[0]
    }
  }

  private getProvidersForModel(model: string): LLMProvider[] {
    return this.registry.getProviders().filter((p) => p.supportsModel(model))
  }

  private selectByLatency(providers: LLMProvider[]): LLMProvider {
    // Select provider with lowest average latency
    let bestProvider = providers[0]!
    let bestLatency = Infinity

    for (const provider of providers) {
      const stats = this.stats.byProvider[provider.name]
      if (stats && stats.requests > 0) {
        const avgLatency = stats.averageLatencyMs
        if (avgLatency < bestLatency) {
          bestLatency = avgLatency
          bestProvider = provider
        }
      }
    }

    return bestProvider
  }

  private selectByCost(providers: LLMProvider[], model: string): LLMProvider {
    // Select provider with lowest cost for the model
    // For now, just use the first one (could be enhanced with cost lookup)
    return providers[0]!
  }

  private shouldFallback(error: Error): boolean {
    const triggerOn = this.config.fallback?.triggerOn ?? ['server_error', 'rate_limit', 'timeout']
    const message = error.message.toLowerCase()

    if (triggerOn.includes('rate_limit') && (message.includes('rate') || message.includes('429'))) {
      return true
    }
    if (triggerOn.includes('timeout') && message.includes('timeout')) {
      return true
    }
    if (triggerOn.includes('server_error') && (message.includes('500') || message.includes('502') || message.includes('503'))) {
      return true
    }
    if (triggerOn.includes('auth_error') && (message.includes('401') || message.includes('403') || message.includes('auth'))) {
      return true
    }

    return false
  }

  private updateStats(
    providerName: ProviderName,
    model: string,
    response: CompletionResponse,
    latencyMs: number
  ): void {
    // Update totals
    this.stats.totalRequests++
    this.stats.totalTokens += response.usage.totalTokens
    this.stats.totalInputTokens += response.usage.promptTokens
    this.stats.totalOutputTokens += response.usage.completionTokens

    const cost = calculateCost(model, response.usage.promptTokens, response.usage.completionTokens)
    this.stats.totalCostUsd += cost

    // Update average latency
    this.stats.averageLatencyMs =
      (this.stats.averageLatencyMs * (this.stats.totalRequests - 1) + latencyMs) / this.stats.totalRequests

    // Update provider stats
    if (!this.stats.byProvider[providerName]) {
      this.stats.byProvider[providerName] = {
        requests: 0,
        tokens: 0,
        costUsd: 0,
        errors: 0,
        averageLatencyMs: 0,
      }
    }
    const providerStats = this.stats.byProvider[providerName]
    const prevRequests = providerStats.requests
    providerStats.requests++
    providerStats.tokens += response.usage.totalTokens
    providerStats.costUsd += cost
    providerStats.averageLatencyMs =
      (providerStats.averageLatencyMs * prevRequests + latencyMs) / providerStats.requests

    // Update model stats
    if (!this.stats.byModel[model]) {
      this.stats.byModel[model] = {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        averageLatencyMs: 0,
      }
    }
    const modelStats = this.stats.byModel[model]
    const prevModelRequests = modelStats.requests
    modelStats.requests++
    modelStats.inputTokens += response.usage.promptTokens
    modelStats.outputTokens += response.usage.completionTokens
    modelStats.costUsd += cost
    modelStats.averageLatencyMs =
      (modelStats.averageLatencyMs * prevModelRequests + latencyMs) / modelStats.requests
  }

  private createEmptyStats(): UsageStats {
    return {
      totalRequests: 0,
      totalTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      averageLatencyMs: 0,
      successRate: 1,
      byProvider: {} as Record<ProviderName, ProviderUsageStats>,
      byModel: {} as Record<string, ModelUsageStats>,
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createLLMRouter(config: RouterConfig): LLMRouter {
  return new LLMRouterImpl(config)
}
