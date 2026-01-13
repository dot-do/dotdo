/**
 * Cost Tracker - Token usage tracking, cost calculation, and budget enforcement
 *
 * Provides per-agent and global cost tracking with:
 * - Token usage accumulation per model/provider
 * - Cost calculation based on configurable pricing
 * - Budget enforcement with soft/hard limits
 * - Alert callbacks for budget thresholds
 * - Detailed usage breakdowns
 *
 * @module agents/cost-tracker
 *
 * @example
 * ```ts
 * import { createCostTracker, withCostTracking, MODEL_PRICING } from './cost-tracker'
 *
 * // Create a tracker with budget
 * const tracker = createCostTracker({
 *   budget: {
 *     maxCost: 10.0,
 *     alertThreshold: 8.0,
 *     onAlert: (cost, threshold) => console.warn('Budget alert:', cost),
 *   },
 *   pricing: MODEL_PRICING,
 * })
 *
 * // Track usage manually
 * tracker.recordUsage({
 *   model: 'gpt-4o',
 *   promptTokens: 100,
 *   completionTokens: 50,
 * })
 *
 * // Get current stats
 * console.log(tracker.getTotalCost())
 * console.log(tracker.getUsageByModel())
 *
 * // Wrap an agent with automatic cost tracking
 * const trackedAgent = withCostTracking(agent, tracker)
 * ```
 */

import type { TokenUsage, AgentResult, Agent, AgentInput, AgentStreamResult } from './types'

// ============================================================================
// Types
// ============================================================================

/**
 * Pricing per 1K tokens for a model
 */
export interface ModelPricing {
  /** Cost per 1K input/prompt tokens */
  input: number
  /** Cost per 1K output/completion tokens */
  output: number
  /** Optional: cost per 1K cached input tokens (for providers that support it) */
  cachedInput?: number
}

/**
 * Map of model names to their pricing
 */
export type PricingTable = Record<string, ModelPricing>

/**
 * Budget configuration for cost tracking
 */
export interface CostBudget {
  /** Maximum total cost allowed (in dollars) */
  maxCost?: number
  /** Cost threshold that triggers an alert (in dollars) */
  alertThreshold?: number
  /** Whether to throw an error when budget is exceeded (hard limit) */
  hardLimit?: boolean
  /** Callback when alert threshold is reached */
  onAlert?: (currentCost: number, threshold: number) => void
  /** Callback when budget is exceeded */
  onExceeded?: (currentCost: number, maxCost: number) => void
}

/**
 * Configuration for the cost tracker
 */
export interface CostTrackerConfig {
  /** Budget constraints */
  budget?: CostBudget
  /** Pricing table for models */
  pricing?: PricingTable
  /** Default model to use when model is not specified */
  defaultModel?: string
  /** ID for this tracker (useful for per-agent tracking) */
  id?: string
}

/**
 * Record of a single usage event
 */
export interface UsageRecord {
  /** Model used */
  model: string
  /** Provider name (optional) */
  provider?: string
  /** Prompt/input tokens */
  promptTokens: number
  /** Completion/output tokens */
  completionTokens: number
  /** Cached input tokens (optional) */
  cachedInputTokens?: number
  /** When this usage occurred */
  timestamp: Date
  /** Calculated cost for this usage */
  cost: number
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Aggregated usage statistics
 */
export interface UsageStats {
  /** Total prompt tokens */
  totalPromptTokens: number
  /** Total completion tokens */
  totalCompletionTokens: number
  /** Total tokens (prompt + completion) */
  totalTokens: number
  /** Total cost */
  totalCost: number
  /** Number of requests */
  requestCount: number
  /** Usage breakdown by model */
  byModel: Record<string, ModelUsage>
  /** Usage breakdown by provider */
  byProvider: Record<string, ProviderUsage>
}

/**
 * Usage statistics for a specific model
 */
export interface ModelUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cost: number
  requestCount: number
}

/**
 * Usage statistics for a specific provider
 */
export interface ProviderUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cost: number
  requestCount: number
}

/**
 * Input for recording usage
 */
export interface RecordUsageInput {
  /** Model used */
  model: string
  /** Provider name (optional) */
  provider?: string
  /** Prompt/input tokens */
  promptTokens: number
  /** Completion/output tokens */
  completionTokens: number
  /** Cached input tokens (optional) */
  cachedInputTokens?: number
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

// ============================================================================
// Default Pricing (as of early 2026)
// ============================================================================

/**
 * Default pricing table for common models (prices per 1K tokens)
 *
 * Note: These are approximate prices and may change. Override with your own
 * pricing table for accurate cost tracking.
 */
export const MODEL_PRICING: PricingTable = {
  // OpenAI Models
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  'o1': { input: 0.015, output: 0.06 },
  'o1-mini': { input: 0.003, output: 0.012 },

  // Anthropic Models
  'claude-opus-4-20250514': { input: 0.015, output: 0.075 },
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
  'claude-3-opus-20240229': { input: 0.015, output: 0.075 },
  'claude-3-sonnet-20240229': { input: 0.003, output: 0.015 },
  'claude-3-haiku-20240307': { input: 0.00025, output: 0.00125 },

  // Google Models
  'gemini-1.5-pro': { input: 0.00125, output: 0.005 },
  'gemini-1.5-flash': { input: 0.000075, output: 0.0003 },
  'gemini-2.0-flash': { input: 0.0001, output: 0.0004 },
}

// ============================================================================
// Budget Exceeded Error
// ============================================================================

/**
 * Error thrown when budget is exceeded with hardLimit enabled
 */
export class BudgetExceededError extends Error {
  readonly currentCost: number
  readonly maxCost: number
  readonly trackerId?: string

  constructor(currentCost: number, maxCost: number, trackerId?: string) {
    super(`Budget exceeded: $${currentCost.toFixed(4)} >= $${maxCost.toFixed(4)}${trackerId ? ` (tracker: ${trackerId})` : ''}`)
    this.name = 'BudgetExceededError'
    this.currentCost = currentCost
    this.maxCost = maxCost
    this.trackerId = trackerId
  }
}

// ============================================================================
// Cost Tracker Implementation
// ============================================================================

/**
 * Cost Tracker - Tracks token usage and costs across agent runs
 *
 * Features:
 * - Per-model and per-provider usage tracking
 * - Configurable pricing tables
 * - Budget enforcement with soft (alert) and hard (error) limits
 * - Detailed usage history and statistics
 */
export class CostTracker {
  readonly id?: string
  private config: CostTrackerConfig
  private pricing: PricingTable
  private records: UsageRecord[] = []
  private alertTriggered = false

  // Cached aggregations (invalidated on new records)
  private cachedStats: UsageStats | null = null

  constructor(config: CostTrackerConfig = {}) {
    this.id = config.id
    this.config = config
    this.pricing = { ...MODEL_PRICING, ...config.pricing }
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  /**
   * Get current configuration
   */
  getConfig(): CostTrackerConfig {
    return { ...this.config }
  }

  /**
   * Update pricing for a model
   */
  setModelPricing(model: string, pricing: ModelPricing): void {
    this.pricing[model] = pricing
  }

  /**
   * Get pricing for a model
   */
  getModelPricing(model: string): ModelPricing | undefined {
    return this.pricing[model]
  }

  /**
   * Update budget configuration
   */
  setBudget(budget: CostBudget): void {
    this.config.budget = budget
    // Reset alert state if threshold increased
    if (budget.alertThreshold && this.getTotalCost() < budget.alertThreshold) {
      this.alertTriggered = false
    }
  }

  // ============================================================================
  // Usage Recording
  // ============================================================================

  /**
   * Record token usage and calculate cost
   *
   * @throws BudgetExceededError if hardLimit is enabled and budget exceeded
   */
  recordUsage(input: RecordUsageInput): UsageRecord {
    const model = input.model || this.config.defaultModel || 'unknown'
    const pricing = this.pricing[model]

    // Calculate cost
    let cost = 0
    if (pricing) {
      const promptCost = (input.promptTokens / 1000) * pricing.input
      const completionCost = (input.completionTokens / 1000) * pricing.output
      const cachedCost = input.cachedInputTokens
        ? (input.cachedInputTokens / 1000) * (pricing.cachedInput ?? pricing.input * 0.5)
        : 0
      cost = promptCost + completionCost + cachedCost
    }

    const record: UsageRecord = {
      model,
      provider: input.provider,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      cachedInputTokens: input.cachedInputTokens,
      timestamp: new Date(),
      cost,
      metadata: input.metadata,
    }

    // Check budget BEFORE recording
    const currentCost = this.getTotalCost()
    const newTotalCost = currentCost + cost
    const budget = this.config.budget

    if (budget?.hardLimit && budget.maxCost && newTotalCost >= budget.maxCost) {
      // Still record it so we have accurate tracking
      this.records.push(record)
      this.cachedStats = null
      budget.onExceeded?.(newTotalCost, budget.maxCost)
      throw new BudgetExceededError(newTotalCost, budget.maxCost, this.id)
    }

    // Record the usage
    this.records.push(record)
    this.cachedStats = null

    // Check for alert threshold
    if (budget?.alertThreshold && !this.alertTriggered && newTotalCost >= budget.alertThreshold) {
      this.alertTriggered = true
      budget.onAlert?.(newTotalCost, budget.alertThreshold)
    }

    return record
  }

  /**
   * Record usage from a TokenUsage object (common return from agent runs)
   */
  recordTokenUsage(usage: TokenUsage, model: string, provider?: string): UsageRecord {
    return this.recordUsage({
      model,
      provider,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
    })
  }

  /**
   * Check if budget would be exceeded by additional cost
   * Useful for pre-flight checks before expensive operations
   */
  wouldExceedBudget(additionalCost: number): boolean {
    const budget = this.config.budget
    if (!budget?.maxCost) return false
    return this.getTotalCost() + additionalCost >= budget.maxCost
  }

  /**
   * Get remaining budget (returns Infinity if no budget set)
   */
  getRemainingBudget(): number {
    const budget = this.config.budget
    if (!budget?.maxCost) return Infinity
    return Math.max(0, budget.maxCost - this.getTotalCost())
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  /**
   * Get total cost across all recorded usage
   */
  getTotalCost(): number {
    return this.getStats().totalCost
  }

  /**
   * Get total tokens across all recorded usage
   */
  getTotalTokens(): number {
    return this.getStats().totalTokens
  }

  /**
   * Get full usage statistics
   */
  getStats(): UsageStats {
    if (this.cachedStats) {
      return this.cachedStats
    }

    const stats: UsageStats = {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      requestCount: this.records.length,
      byModel: {},
      byProvider: {},
    }

    for (const record of this.records) {
      stats.totalPromptTokens += record.promptTokens
      stats.totalCompletionTokens += record.completionTokens
      stats.totalTokens += record.promptTokens + record.completionTokens
      stats.totalCost += record.cost

      // By model
      if (!stats.byModel[record.model]) {
        stats.byModel[record.model] = {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          cost: 0,
          requestCount: 0,
        }
      }
      const modelStats = stats.byModel[record.model]
      modelStats.promptTokens += record.promptTokens
      modelStats.completionTokens += record.completionTokens
      modelStats.totalTokens += record.promptTokens + record.completionTokens
      modelStats.cost += record.cost
      modelStats.requestCount++

      // By provider
      const provider = record.provider ?? 'unknown'
      if (!stats.byProvider[provider]) {
        stats.byProvider[provider] = {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          cost: 0,
          requestCount: 0,
        }
      }
      const providerStats = stats.byProvider[provider]
      providerStats.promptTokens += record.promptTokens
      providerStats.completionTokens += record.completionTokens
      providerStats.totalTokens += record.promptTokens + record.completionTokens
      providerStats.cost += record.cost
      providerStats.requestCount++
    }

    this.cachedStats = stats
    return stats
  }

  /**
   * Get usage breakdown by model
   */
  getUsageByModel(): Record<string, ModelUsage> {
    return { ...this.getStats().byModel }
  }

  /**
   * Get usage breakdown by provider
   */
  getUsageByProvider(): Record<string, ProviderUsage> {
    return { ...this.getStats().byProvider }
  }

  /**
   * Get all usage records
   */
  getRecords(): UsageRecord[] {
    return [...this.records]
  }

  /**
   * Get records within a time range
   */
  getRecordsBetween(start: Date, end: Date): UsageRecord[] {
    return this.records.filter((r) => r.timestamp >= start && r.timestamp <= end)
  }

  // ============================================================================
  // Reset and Export
  // ============================================================================

  /**
   * Reset all tracked usage
   */
  reset(): void {
    this.records = []
    this.cachedStats = null
    this.alertTriggered = false
  }

  /**
   * Export state for persistence
   */
  exportState(): {
    id?: string
    records: UsageRecord[]
    config: CostTrackerConfig
  } {
    return {
      id: this.id,
      records: [...this.records],
      config: { ...this.config },
    }
  }

  /**
   * Import state from persistence
   */
  importState(state: { records: UsageRecord[]; config?: CostTrackerConfig }): void {
    this.records = [...state.records]
    if (state.config) {
      this.config = { ...this.config, ...state.config }
    }
    this.cachedStats = null
    // Re-check alert state
    if (this.config.budget?.alertThreshold) {
      this.alertTriggered = this.getTotalCost() >= this.config.budget.alertThreshold
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a cost tracker instance
 *
 * @example
 * ```ts
 * // Simple tracker
 * const tracker = createCostTracker()
 *
 * // With budget
 * const tracker = createCostTracker({
 *   budget: {
 *     maxCost: 10.0,
 *     alertThreshold: 8.0,
 *     hardLimit: true,
 *     onAlert: (cost, threshold) => console.warn('Budget alert!'),
 *   },
 * })
 *
 * // With custom pricing
 * const tracker = createCostTracker({
 *   pricing: {
 *     'my-custom-model': { input: 0.001, output: 0.002 },
 *   },
 * })
 * ```
 */
export function createCostTracker(config?: CostTrackerConfig): CostTracker {
  return new CostTracker(config)
}

// ============================================================================
// Agent Integration
// ============================================================================

/**
 * Agent with cost tracking capabilities
 */
export interface AgentWithCostTracking extends Agent {
  /** Get the cost tracker instance */
  getCostTracker(): CostTracker
  /** Get total cost for this agent */
  getTotalCost(): number
  /** Get remaining budget */
  getRemainingBudget(): number
}

/**
 * Wrap an agent with automatic cost tracking
 *
 * @example
 * ```ts
 * const tracker = createCostTracker({ budget: { maxCost: 5.0 } })
 * const trackedAgent = withCostTracking(agent, tracker)
 *
 * const result = await trackedAgent.run({ prompt: 'Hello!' })
 * console.log('Cost so far:', trackedAgent.getTotalCost())
 * ```
 */
export function withCostTracking(
  agent: Agent,
  tracker: CostTracker,
  options?: { provider?: string }
): AgentWithCostTracking {
  return {
    config: agent.config,
    provider: agent.provider,

    getCostTracker(): CostTracker {
      return tracker
    },

    getTotalCost(): number {
      return tracker.getTotalCost()
    },

    getRemainingBudget(): number {
      return tracker.getRemainingBudget()
    },

    async run(input: AgentInput): Promise<AgentResult> {
      // Check budget before running
      if (tracker.wouldExceedBudget(0) && tracker.getConfig().budget?.hardLimit) {
        const budget = tracker.getConfig().budget!
        throw new BudgetExceededError(tracker.getTotalCost(), budget.maxCost!, tracker.id)
      }

      const result = await agent.run(input)

      // Record usage after successful run
      if (result.usage) {
        tracker.recordTokenUsage(result.usage, agent.config.model, options?.provider)
      }

      return result
    },

    stream(input: AgentInput): AgentStreamResult {
      const streamResult = agent.stream(input)

      // Wrap the result promise to track usage
      const wrappedResult = streamResult.result.then((result) => {
        if (result.usage) {
          tracker.recordTokenUsage(result.usage, agent.config.model, options?.provider)
        }
        return result
      })

      return {
        ...streamResult,
        result: wrappedResult,
      }
    },

    // Pass through optional methods
    spawnSubagent: agent.spawnSubagent?.bind(agent),
    handoff: agent.handoff?.bind(agent),
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate cost for a given usage and model
 *
 * @example
 * ```ts
 * const cost = calculateCost({
 *   model: 'gpt-4o',
 *   promptTokens: 1000,
 *   completionTokens: 500,
 * })
 * ```
 */
export function calculateCost(
  input: { model: string; promptTokens: number; completionTokens: number; cachedInputTokens?: number },
  pricing: PricingTable = MODEL_PRICING
): number {
  const modelPricing = pricing[input.model]
  if (!modelPricing) return 0

  const promptCost = (input.promptTokens / 1000) * modelPricing.input
  const completionCost = (input.completionTokens / 1000) * modelPricing.output
  const cachedCost = input.cachedInputTokens
    ? (input.cachedInputTokens / 1000) * (modelPricing.cachedInput ?? modelPricing.input * 0.5)
    : 0

  return promptCost + completionCost + cachedCost
}

/**
 * Estimate cost for a prompt before running
 *
 * Uses approximate token counting (4 chars per token)
 */
export function estimateCost(
  prompt: string,
  model: string,
  estimatedOutputRatio = 1.0,
  pricing: PricingTable = MODEL_PRICING
): number {
  const estimatedPromptTokens = Math.ceil(prompt.length / 4)
  const estimatedCompletionTokens = Math.ceil(estimatedPromptTokens * estimatedOutputRatio)

  return calculateCost(
    {
      model,
      promptTokens: estimatedPromptTokens,
      completionTokens: estimatedCompletionTokens,
    },
    pricing
  )
}

/**
 * Merge multiple cost trackers into aggregate stats
 *
 * Useful for getting total costs across multiple agents
 */
export function mergeTrackerStats(trackers: CostTracker[]): UsageStats {
  const merged: UsageStats = {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    requestCount: 0,
    byModel: {},
    byProvider: {},
  }

  for (const tracker of trackers) {
    const stats = tracker.getStats()
    merged.totalPromptTokens += stats.totalPromptTokens
    merged.totalCompletionTokens += stats.totalCompletionTokens
    merged.totalTokens += stats.totalTokens
    merged.totalCost += stats.totalCost
    merged.requestCount += stats.requestCount

    // Merge by model
    for (const [model, usage] of Object.entries(stats.byModel)) {
      if (!merged.byModel[model]) {
        merged.byModel[model] = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, requestCount: 0 }
      }
      merged.byModel[model].promptTokens += usage.promptTokens
      merged.byModel[model].completionTokens += usage.completionTokens
      merged.byModel[model].totalTokens += usage.totalTokens
      merged.byModel[model].cost += usage.cost
      merged.byModel[model].requestCount += usage.requestCount
    }

    // Merge by provider
    for (const [provider, usage] of Object.entries(stats.byProvider)) {
      if (!merged.byProvider[provider]) {
        merged.byProvider[provider] = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, requestCount: 0 }
      }
      merged.byProvider[provider].promptTokens += usage.promptTokens
      merged.byProvider[provider].completionTokens += usage.completionTokens
      merged.byProvider[provider].totalTokens += usage.totalTokens
      merged.byProvider[provider].cost += usage.cost
      merged.byProvider[provider].requestCount += usage.requestCount
    }
  }

  return merged
}

export default CostTracker
