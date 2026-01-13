/**
 * LLM Router - Multi-provider routing with fallback, load balancing, and cost tracking
 *
 * Provides:
 * - Provider abstraction with fallback logic
 * - Multiple load balancing strategies
 * - Cost tracking and budget limits
 * - Health checks and automatic recovery
 *
 * @module agents/router
 *
 * @example
 * ```ts
 * import { createRouter } from './router'
 * import { createOpenAIProvider, createClaudeProvider } from '../providers'
 *
 * const router = createRouter({
 *   providers: [
 *     {
 *       name: 'openai',
 *       provider: createOpenAIProvider({ apiKey: process.env.OPENAI_KEY }),
 *       priority: 1,
 *       models: ['gpt-4o', 'gpt-4o-mini'],
 *       costPerToken: { input: 0.0025, output: 0.01 },
 *     },
 *     {
 *       name: 'anthropic',
 *       provider: createClaudeProvider({ apiKey: process.env.ANTHROPIC_KEY }),
 *       priority: 2,
 *       models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514'],
 *       costPerToken: { input: 0.003, output: 0.015 },
 *     },
 *   ],
 *   strategy: 'priority',
 *   fallback: { enabled: true, maxRetries: 3 },
 *   budget: { maxTotalCost: 100.0, alertThreshold: 80.0 },
 * })
 *
 * const agent = router.createAgent({
 *   id: 'my-agent',
 *   name: 'My Agent',
 *   instructions: 'You are helpful.',
 *   model: 'gpt-4o',
 * })
 *
 * const result = await agent.run({ prompt: 'Hello!' })
 * console.log(router.getMetrics())
 * ```
 */

import type {
  Agent,
  AgentConfig,
  AgentInput,
  AgentProvider,
  AgentResult,
  AgentStreamResult,
  TokenUsage,
} from '../types'

// ============================================================================
// Types
// ============================================================================

/**
 * Load balancing strategy for selecting providers
 */
export type LoadBalanceStrategy =
  | 'priority' // Always use highest priority healthy provider
  | 'round-robin' // Distribute evenly across providers
  | 'weighted' // Distribute based on weights
  | 'least-latency' // Prefer providers with lower latency
  | 'cost' // Prefer providers with lower cost

/**
 * Configuration for a single provider
 */
export interface ProviderConfig {
  /** Unique name for the provider */
  name: string
  /** The actual provider implementation */
  provider: AgentProvider
  /** Priority (lower = higher priority, used for fallback ordering) */
  priority?: number
  /** Weight for weighted load balancing (higher = more traffic) */
  weight?: number
  /** Models supported by this provider */
  models?: string[]
  /** Whether this provider is enabled */
  enabled?: boolean
  /** Cost per 1K tokens (for cost tracking and cost-based routing) */
  costPerToken?: {
    input: number
    output: number
  }
}

/**
 * Fallback configuration
 */
export interface FallbackConfig {
  /** Whether fallback is enabled */
  enabled?: boolean
  /** Maximum retry attempts across all providers */
  maxRetries?: number
  /** Delay between retries in milliseconds */
  retryDelayMs?: number
}

/**
 * Budget configuration
 */
export interface BudgetConfig {
  /** Maximum total cost allowed */
  maxTotalCost?: number
  /** Cost threshold to trigger alert */
  alertThreshold?: number
  /** Whether to hard stop when budget exceeded */
  hardLimit?: boolean
  /** Callback when alert threshold is reached */
  onAlert?: (currentCost: number, threshold: number) => void
}

/**
 * Health check configuration
 */
export interface HealthCheckConfig {
  /** Number of consecutive failures before marking unhealthy */
  failureThreshold?: number
  /** Time in ms before attempting to recover unhealthy provider */
  recoveryPeriodMs?: number
}

/**
 * Router configuration
 */
export interface RouterConfig {
  /** Configured providers */
  providers: ProviderConfig[]
  /** Load balancing strategy */
  strategy?: LoadBalanceStrategy
  /** Fallback configuration */
  fallback?: FallbackConfig
  /** Budget configuration */
  budget?: BudgetConfig
  /** Health check configuration */
  healthCheck?: HealthCheckConfig
}

/**
 * Router metrics
 */
export interface RouterMetrics {
  totalRequests: number
  successCount: number
  failureCount: number
  totalCost: number
  costByProvider: Record<string, number>
  totalTokens: number
  promptTokens: number
  completionTokens: number
  averageLatencyMs: number
  latencyByProvider: Record<string, number>
}

/**
 * Health status for a provider
 */
export interface ProviderHealthStatus {
  healthy: boolean
  consecutiveFailures: number
  lastFailure?: Date
  lastSuccess?: Date
  averageLatencyMs: number
}

// ============================================================================
// Internal State Types
// ============================================================================

interface ProviderState {
  config: ProviderConfig
  healthy: boolean
  consecutiveFailures: number
  lastFailure?: Date
  lastSuccess?: Date
  totalLatencyMs: number
  requestCount: number
  totalCost: number
}

// ============================================================================
// LLM Router Implementation
// ============================================================================

/**
 * Multi-provider LLM Router
 *
 * Routes requests to multiple providers with fallback, load balancing,
 * cost tracking, and health checks.
 */
export class LLMRouter implements AgentProvider {
  readonly name = 'router'
  readonly version = '1.0.0'

  private providers: Map<string, ProviderState> = new Map()
  private providerOrder: string[] = []
  private _strategy: LoadBalanceStrategy
  private fallbackConfig: Required<FallbackConfig>
  private budgetConfig: BudgetConfig
  private healthCheckConfig: Required<HealthCheckConfig>

  // Round-robin state
  private roundRobinIndex = 0

  // Metrics
  private metrics: RouterMetrics = {
    totalRequests: 0,
    successCount: 0,
    failureCount: 0,
    totalCost: 0,
    costByProvider: {},
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    averageLatencyMs: 0,
    latencyByProvider: {},
  }
  private totalLatencyMs = 0

  constructor(config: RouterConfig) {
    if (!config.providers || config.providers.length === 0) {
      throw new Error('At least one provider is required')
    }

    this._strategy = config.strategy ?? 'priority'

    this.fallbackConfig = {
      enabled: config.fallback?.enabled ?? true,
      maxRetries: config.fallback?.maxRetries ?? config.providers.length,
      retryDelayMs: config.fallback?.retryDelayMs ?? 0,
    }

    this.budgetConfig = config.budget ?? {}

    this.healthCheckConfig = {
      failureThreshold: config.healthCheck?.failureThreshold ?? 3,
      recoveryPeriodMs: config.healthCheck?.recoveryPeriodMs ?? 30000,
    }

    // Initialize providers
    for (const providerConfig of config.providers) {
      this.addProviderInternal(providerConfig)
    }

    // Sort providers by priority
    this.sortProviders()
  }

  // ============================================================================
  // Public Properties
  // ============================================================================

  get strategy(): LoadBalanceStrategy {
    return this._strategy
  }

  get fallbackEnabled(): boolean {
    return this.fallbackConfig.enabled
  }

  get budget(): BudgetConfig {
    return this.budgetConfig
  }

  // ============================================================================
  // AgentProvider Interface
  // ============================================================================

  createAgent(config: AgentConfig): Agent {
    // Find providers that support the requested model
    const compatibleProviders = this.getCompatibleProviders(config.model)

    if (compatibleProviders.length === 0) {
      throw new Error(`No provider supports model: ${config.model}`)
    }

    return new RoutedAgent(this, config, compatibleProviders)
  }

  async listModels(): Promise<string[]> {
    const models = new Set<string>()
    for (const state of this.providers.values()) {
      const providerModels = await state.config.provider.listModels?.()
      if (providerModels) {
        for (const model of providerModels) {
          models.add(model)
        }
      }
      // Also include explicitly configured models
      if (state.config.models) {
        for (const model of state.config.models) {
          models.add(model)
        }
      }
    }
    return Array.from(models)
  }

  // ============================================================================
  // Provider Selection
  // ============================================================================

  /**
   * Select the next provider based on strategy
   */
  selectProvider(compatibleProviders: string[]): string | null {
    const healthyProviders = compatibleProviders.filter((name) => {
      const state = this.providers.get(name)
      return state && state.healthy && state.config.enabled !== false
    })

    if (healthyProviders.length === 0) {
      return null
    }

    switch (this._strategy) {
      case 'priority':
        return this.selectByPriority(healthyProviders)
      case 'round-robin':
        return this.selectRoundRobin(healthyProviders)
      case 'weighted':
        return this.selectWeighted(healthyProviders)
      case 'least-latency':
        return this.selectLeastLatency(healthyProviders)
      case 'cost':
        return this.selectLowestCost(healthyProviders)
      default:
        return healthyProviders[0]
    }
  }

  private selectByPriority(providers: string[]): string {
    // Providers are already sorted by priority
    return providers[0]
  }

  private selectRoundRobin(providers: string[]): string {
    const index = this.roundRobinIndex % providers.length
    this.roundRobinIndex++
    return providers[index]
  }

  private selectWeighted(providers: string[]): string {
    const weights: { name: string; cumulativeWeight: number }[] = []
    let totalWeight = 0

    for (const name of providers) {
      const state = this.providers.get(name)!
      totalWeight += state.config.weight ?? 1
      weights.push({ name, cumulativeWeight: totalWeight })
    }

    const random = Math.random() * totalWeight
    for (const { name, cumulativeWeight } of weights) {
      if (random < cumulativeWeight) {
        return name
      }
    }

    return providers[providers.length - 1]
  }

  private selectLeastLatency(providers: string[]): string {
    let bestProvider = providers[0]
    let bestLatency = Infinity

    for (const name of providers) {
      const state = this.providers.get(name)!
      const avgLatency = state.requestCount > 0 ? state.totalLatencyMs / state.requestCount : 0
      if (avgLatency < bestLatency) {
        bestLatency = avgLatency
        bestProvider = name
      }
    }

    return bestProvider
  }

  private selectLowestCost(providers: string[]): string {
    let bestProvider = providers[0]
    let lowestCost = Infinity

    for (const name of providers) {
      const state = this.providers.get(name)!
      const cost = state.config.costPerToken
      if (cost) {
        // Use a weighted average (assuming typical 3:1 input:output ratio)
        const avgCost = cost.input * 0.75 + cost.output * 0.25
        if (avgCost < lowestCost) {
          lowestCost = avgCost
          bestProvider = name
        }
      }
    }

    return bestProvider
  }

  // ============================================================================
  // Request Execution
  // ============================================================================

  /**
   * Execute a request with fallback support
   */
  async executeWithFallback(
    compatibleProviders: string[],
    config: AgentConfig,
    input: AgentInput
  ): Promise<AgentResult> {
    // Check budget before executing
    if (this.budgetConfig.hardLimit && this.budgetConfig.maxTotalCost) {
      if (this.metrics.totalCost >= this.budgetConfig.maxTotalCost) {
        throw new Error('Budget exceeded')
      }
    }

    const maxRetries = this.fallbackConfig.enabled
      ? this.fallbackConfig.maxRetries
      : 1

    const errors: Error[] = []
    const triedProviders = new Set<string>()

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Select provider, excluding already tried ones if fallback enabled
      let providerName: string | null = null

      if (this.fallbackConfig.enabled) {
        const remaining = compatibleProviders.filter((p) => !triedProviders.has(p))
        providerName = this.selectProvider(remaining)
      } else {
        providerName = this.selectProvider(compatibleProviders)
      }

      if (!providerName) {
        break
      }

      triedProviders.add(providerName)
      const state = this.providers.get(providerName)!

      try {
        const startTime = Date.now()

        // Create agent from underlying provider and run
        const agent = state.config.provider.createAgent(config)
        const result = await agent.run(input)

        const latencyMs = Date.now() - startTime

        // Record success
        this.recordSuccess(providerName, latencyMs, result.usage)

        return result
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        errors.push(err)

        // Record failure
        this.recordFailure(providerName)

        // If fallback disabled, throw immediately
        if (!this.fallbackConfig.enabled) {
          throw err
        }

        // Delay before retry if configured
        if (this.fallbackConfig.retryDelayMs > 0 && attempt < maxRetries - 1) {
          await new Promise((r) => setTimeout(r, this.fallbackConfig.retryDelayMs))
        }
      }
    }

    throw new Error(`All providers failed: ${errors.map((e) => e.message).join(', ')}`)
  }

  // ============================================================================
  // Metrics Recording
  // ============================================================================

  private recordSuccess(providerName: string, latencyMs: number, usage: TokenUsage): void {
    const state = this.providers.get(providerName)!

    // Update provider state
    state.healthy = true
    state.consecutiveFailures = 0
    state.lastSuccess = new Date()
    state.totalLatencyMs += latencyMs
    state.requestCount++

    // Calculate cost
    const costConfig = state.config.costPerToken
    let cost = 0
    if (costConfig) {
      cost = (usage.promptTokens / 1000) * costConfig.input + (usage.completionTokens / 1000) * costConfig.output
      state.totalCost += cost
    }

    // Update global metrics
    this.metrics.totalRequests++
    this.metrics.successCount++
    this.metrics.totalTokens += usage.totalTokens
    this.metrics.promptTokens += usage.promptTokens
    this.metrics.completionTokens += usage.completionTokens
    this.metrics.totalCost += cost
    this.metrics.costByProvider[providerName] = (this.metrics.costByProvider[providerName] ?? 0) + cost

    this.totalLatencyMs += latencyMs
    this.metrics.averageLatencyMs = this.totalLatencyMs / this.metrics.totalRequests
    this.metrics.latencyByProvider[providerName] = state.totalLatencyMs / state.requestCount

    // Check budget alert
    if (
      this.budgetConfig.alertThreshold &&
      this.budgetConfig.onAlert &&
      this.metrics.totalCost >= this.budgetConfig.alertThreshold
    ) {
      this.budgetConfig.onAlert(this.metrics.totalCost, this.budgetConfig.alertThreshold)
    }
  }

  private recordFailure(providerName: string): void {
    const state = this.providers.get(providerName)!

    state.consecutiveFailures++
    state.lastFailure = new Date()

    // Mark unhealthy if threshold exceeded
    if (state.consecutiveFailures >= this.healthCheckConfig.failureThreshold) {
      state.healthy = false
    }

    // Update global metrics
    this.metrics.totalRequests++
    this.metrics.failureCount++
  }

  // ============================================================================
  // Health Checks
  // ============================================================================

  /**
   * Check if an unhealthy provider should be recovered
   */
  private checkRecovery(): void {
    const now = Date.now()

    for (const state of this.providers.values()) {
      if (!state.healthy && state.lastFailure) {
        const timeSinceFailure = now - state.lastFailure.getTime()
        if (timeSinceFailure >= this.healthCheckConfig.recoveryPeriodMs) {
          // Attempt recovery
          state.healthy = true
          state.consecutiveFailures = 0
        }
      }
    }
  }

  /**
   * Get health status for all providers
   */
  getHealthStatus(): Record<string, ProviderHealthStatus> {
    this.checkRecovery()

    const status: Record<string, ProviderHealthStatus> = {}

    for (const [name, state] of this.providers) {
      status[name] = {
        healthy: state.healthy,
        consecutiveFailures: state.consecutiveFailures,
        lastFailure: state.lastFailure,
        lastSuccess: state.lastSuccess,
        averageLatencyMs: state.requestCount > 0 ? state.totalLatencyMs / state.requestCount : 0,
      }
    }

    return status
  }

  // ============================================================================
  // Metrics
  // ============================================================================

  /**
   * Get current metrics
   */
  getMetrics(): RouterMetrics {
    return { ...this.metrics }
  }

  /**
   * Reset all metrics
   */
  resetMetrics(): void {
    this.metrics = {
      totalRequests: 0,
      successCount: 0,
      failureCount: 0,
      totalCost: 0,
      costByProvider: {},
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      averageLatencyMs: 0,
      latencyByProvider: {},
    }
    this.totalLatencyMs = 0

    // Reset per-provider metrics
    for (const state of this.providers.values()) {
      state.totalLatencyMs = 0
      state.requestCount = 0
      state.totalCost = 0
    }
  }

  // ============================================================================
  // Provider Management
  // ============================================================================

  /**
   * Get all configured providers
   */
  getProviders(): ProviderConfig[] {
    return Array.from(this.providers.values()).map((state) => state.config)
  }

  /**
   * Add a new provider
   */
  addProvider(config: ProviderConfig): void {
    this.addProviderInternal(config)
    this.sortProviders()
  }

  /**
   * Remove a provider by name
   */
  removeProvider(name: string): void {
    this.providers.delete(name)
    this.providerOrder = this.providerOrder.filter((n) => n !== name)
  }

  /**
   * Enable or disable a provider
   */
  setProviderEnabled(name: string, enabled: boolean): void {
    const state = this.providers.get(name)
    if (state) {
      state.config.enabled = enabled
    }
  }

  private addProviderInternal(config: ProviderConfig): void {
    this.providers.set(config.name, {
      config: {
        priority: 1,
        weight: 1,
        enabled: true,
        ...config,
      },
      healthy: true,
      consecutiveFailures: 0,
      totalLatencyMs: 0,
      requestCount: 0,
      totalCost: 0,
    })
    this.providerOrder.push(config.name)
    this.metrics.costByProvider[config.name] = 0
    this.metrics.latencyByProvider[config.name] = 0
  }

  private sortProviders(): void {
    this.providerOrder.sort((a, b) => {
      const stateA = this.providers.get(a)!
      const stateB = this.providers.get(b)!
      return (stateA.config.priority ?? 1) - (stateB.config.priority ?? 1)
    })
  }

  private getCompatibleProviders(model: string): string[] {
    this.checkRecovery()

    const compatible: string[] = []

    for (const name of this.providerOrder) {
      const state = this.providers.get(name)!
      if (state.config.enabled === false) continue

      const models = state.config.models
      if (!models || models.includes(model)) {
        compatible.push(name)
      }
    }

    return compatible
  }
}

// ============================================================================
// Routed Agent Implementation
// ============================================================================

/**
 * Agent that routes requests through the LLM Router
 */
class RoutedAgent implements Agent {
  readonly config: AgentConfig
  readonly provider: LLMRouter

  private compatibleProviders: string[]

  constructor(router: LLMRouter, config: AgentConfig, compatibleProviders: string[]) {
    this.provider = router
    this.config = config
    this.compatibleProviders = compatibleProviders
  }

  async run(input: AgentInput): Promise<AgentResult> {
    return this.provider.executeWithFallback(this.compatibleProviders, this.config, input)
  }

  stream(input: AgentInput): AgentStreamResult {
    // For now, fall back to run-based streaming
    const self = this

    let resolveResult: (result: AgentResult) => void
    let rejectResult: (error: Error) => void
    const resultPromise = new Promise<AgentResult>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })

    let resolveText: (text: string) => void
    const textPromise = new Promise<string>((resolve) => {
      resolveText = resolve
    })

    let resolveToolCalls: (calls: AgentResult['toolCalls']) => void
    const toolCallsPromise = new Promise<AgentResult['toolCalls']>((resolve) => {
      resolveToolCalls = resolve
    })

    let resolveUsage: (usage: AgentResult['usage']) => void
    const usagePromise = new Promise<AgentResult['usage']>((resolve) => {
      resolveUsage = resolve
    })

    async function* generateEvents() {
      try {
        const result = await self.run(input)

        if (result.text) {
          yield {
            type: 'text-delta' as const,
            data: { textDelta: result.text },
            timestamp: new Date(),
          }
        }

        yield {
          type: 'done' as const,
          data: { finalResult: result },
          timestamp: new Date(),
        }

        resolveResult(result)
        resolveText(result.text)
        resolveToolCalls(result.toolCalls)
        resolveUsage(result.usage)
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        yield {
          type: 'error' as const,
          data: { error: err },
          timestamp: new Date(),
        }
        rejectResult(err)
      }
    }

    return {
      [Symbol.asyncIterator]: generateEvents,
      result: resultPromise,
      text: textPromise,
      toolCalls: toolCallsPromise,
      usage: usagePromise,
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an LLM Router
 *
 * @example
 * ```ts
 * const router = createRouter({
 *   providers: [
 *     { name: 'openai', provider: createOpenAIProvider(), priority: 1 },
 *     { name: 'anthropic', provider: createClaudeProvider(), priority: 2 },
 *   ],
 *   strategy: 'priority',
 *   fallback: { enabled: true },
 * })
 * ```
 */
export function createRouter(config: RouterConfig): LLMRouter {
  return new LLMRouter(config)
}

export default LLMRouter
