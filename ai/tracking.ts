// Cost and token tracking for @dotdo/ai
// Supports multi-provider usage tracking, budget limits, and reporting

import type { AIMeta } from './promise'
import { countTokens as countTokensTiktoken, estimateCost as estimateCostTiktoken } from './tokens'

// Import Provider from router to avoid duplicate exports in index.ts
import type { Provider } from './router'

export interface ModelConfig {
  inputCostPer1M: number
  outputCostPer1M: number
}

export interface UsageRecord {
  provider: Provider
  model: string
  tokens: { input: number; output: number }
  cost: number
  timestamp: number
}

export interface UsageStats {
  cost: number
  tokens: number
  requests: number
}

export interface UsageReport {
  totalCost: number
  totalTokens: number
  requestCount: number
  byProvider: Record<Provider, UsageStats>
  byModel: Record<string, UsageStats>
  startTime?: number | undefined
  endTime?: number | undefined
}

export interface ReportFilter {
  since?: number
  until?: number
  provider?: Provider
  model?: string
}

export class BudgetExceededError extends Error {
  constructor(
    message: string,
    public currentCost: number,
    public budgetLimit: number,
  ) {
    super(message)
    this.name = 'BudgetExceededError'
  }
}

// Pricing tables (as of January 2025)
const PRICING: Record<Provider, Record<string, ModelConfig>> = {
  openai: {
    'gpt-4o': { inputCostPer1M: 2.50, outputCostPer1M: 10.00 },
    'gpt-4o-mini': { inputCostPer1M: 0.150, outputCostPer1M: 0.600 },
    'o1': { inputCostPer1M: 15.00, outputCostPer1M: 60.00 },
    'o1-mini': { inputCostPer1M: 3.00, outputCostPer1M: 12.00 },
  },
  anthropic: {
    'claude-opus-4': { inputCostPer1M: 15.00, outputCostPer1M: 75.00 },
    'claude-sonnet-4': { inputCostPer1M: 3.00, outputCostPer1M: 15.00 },
    'claude-haiku-4': { inputCostPer1M: 0.80, outputCostPer1M: 4.00 },
  },
  google: {
    'gemini-2.0-flash': { inputCostPer1M: 0, outputCostPer1M: 0 }, // Free tier
    'gemini-1.5-pro': { inputCostPer1M: 1.25, outputCostPer1M: 5.00 },
  },
  cloudflare: {
    // Workers AI pricing: $0.011 per 1000 neurons
    // Approximate as total tokens * $0.011 / 1000
    '@cf/meta/llama-3.1-8b-instruct': { inputCostPer1M: 11.00, outputCostPer1M: 0 },
  },
}

/**
 * Count tokens in text using tiktoken for accurate BPE tokenization.
 *
 * @param text - The text to count tokens for
 * @param model - Optional model name for model-specific encoding
 * @returns The number of tokens
 *
 * @example
 * ```ts
 * const tokens = countTokens('Hello, world!')
 * const tokens2 = countTokens('Hello, world!', 'gpt-4o')
 * ```
 */
export function countTokens(text: string, model?: string): number {
  return countTokensTiktoken(text, model)
}

/**
 * Estimate cost based on token count and model.
 * Wrapper around tokens.estimateCost for convenience.
 */
export function estimateCost(
  tokens: number | { input: number; output: number },
  model: string,
): number {
  return estimateCostTiktoken(tokens, model)
}

/**
 * Calculate cost for a given provider, model, and token usage.
 */
export function calculateCost(
  provider: Provider,
  model: string,
  tokens: { input: number; output: number },
): number {
  const providerPricing = PRICING[provider]
  if (!providerPricing) return 0

  const modelPricing = providerPricing[model]
  if (!modelPricing) return 0

  // Cloudflare Workers AI uses combined token count
  if (provider === 'cloudflare') {
    const totalTokens = tokens.input + tokens.output
    return (totalTokens * modelPricing.inputCostPer1M) / 1_000_000
  }

  const inputCost = (tokens.input * modelPricing.inputCostPer1M) / 1_000_000
  const outputCost = (tokens.output * modelPricing.outputCostPer1M) / 1_000_000

  return inputCost + outputCost
}

/**
 * UsageTracker tracks AI usage across providers and models.
 * Supports budget limits, usage reporting, and alerts.
 */
export class UsageTracker {
  private records: UsageRecord[] = []
  private budgetLimit: number = Infinity
  private thresholdCallbacks: Array<{
    threshold: number
    callback: (currentCost: number) => void
    triggered: boolean
  }> = []

  /**
   * Record a usage event.
   */
  record(record: UsageRecord): void {
    this.records.push(record)

    // Check budget limit
    const totalCost = this.getTotalCost()
    if (totalCost > this.budgetLimit) {
      throw new BudgetExceededError(
        `Budget exceeded: $${totalCost.toFixed(6)} > $${this.budgetLimit.toFixed(6)}`,
        totalCost,
        this.budgetLimit,
      )
    }

    // Check threshold callbacks
    if (this.budgetLimit !== Infinity) {
      const percentage = totalCost / this.budgetLimit
      for (const item of this.thresholdCallbacks) {
        if (!item.triggered && percentage >= item.threshold) {
          item.triggered = true
          item.callback(totalCost)
        }
      }
    }
  }

  /**
   * Record usage from AIMeta object.
   * Auto-calculates cost if not provided.
   */
  recordFromMeta(provider: Provider, meta: AIMeta): void {
    if (!meta.tokens) return

    const cost = meta.cost ?? calculateCost(provider, meta.model ?? 'unknown', meta.tokens)

    this.record({
      provider,
      model: meta.model ?? 'unknown',
      tokens: meta.tokens,
      cost,
      timestamp: Date.now(),
    })
  }

  /**
   * Set budget limit in dollars.
   */
  setBudgetLimit(limit: number): void {
    this.budgetLimit = limit
    // Reset threshold triggers when budget changes
    for (const item of this.thresholdCallbacks) {
      item.triggered = false
    }
  }

  /**
   * Get current budget limit.
   */
  getBudgetLimit(): number {
    return this.budgetLimit
  }

  /**
   * Register a callback to be called when cost reaches a threshold.
   * Threshold is a percentage (0-1) of the budget limit.
   */
  onBudgetThreshold(threshold: number, callback: (currentCost: number) => void): void {
    this.thresholdCallbacks.push({
      threshold,
      callback,
      triggered: false,
    })
  }

  /**
   * Get total cost across all records.
   */
  private getTotalCost(): number {
    return this.records.reduce((sum, record) => sum + record.cost, 0)
  }

  /**
   * Generate a usage report with optional filters.
   */
  getReport(filter?: ReportFilter): UsageReport {
    // Filter records
    let filteredRecords = this.records

    if (filter?.since) {
      filteredRecords = filteredRecords.filter(r => r.timestamp >= filter.since!)
    }

    if (filter?.until) {
      filteredRecords = filteredRecords.filter(r => r.timestamp <= filter.until!)
    }

    if (filter?.provider) {
      filteredRecords = filteredRecords.filter(r => r.provider === filter.provider)
    }

    if (filter?.model) {
      filteredRecords = filteredRecords.filter(r => r.model === filter.model)
    }

    // Aggregate stats
    const byProvider: Record<string, UsageStats> = {}
    const byModel: Record<string, UsageStats> = {}
    let totalCost = 0
    let totalTokens = 0
    let requestCount = 0
    let startTime: number | undefined
    let endTime: number | undefined

    for (const record of filteredRecords) {
      requestCount++
      totalCost += record.cost
      totalTokens += record.tokens.input + record.tokens.output

      if (!startTime || record.timestamp < startTime) {
        startTime = record.timestamp
      }
      if (!endTime || record.timestamp > endTime) {
        endTime = record.timestamp
      }

      // By provider
      if (!byProvider[record.provider]) {
        byProvider[record.provider] = { cost: 0, tokens: 0, requests: 0 }
      }
      const providerStats = byProvider[record.provider]!
      providerStats.cost += record.cost
      providerStats.tokens += record.tokens.input + record.tokens.output
      providerStats.requests++

      // By model
      if (!byModel[record.model]) {
        byModel[record.model] = { cost: 0, tokens: 0, requests: 0 }
      }
      const modelStats = byModel[record.model]!
      modelStats.cost += record.cost
      modelStats.tokens += record.tokens.input + record.tokens.output
      modelStats.requests++
    }

    return {
      totalCost,
      totalTokens,
      requestCount,
      byProvider: byProvider as Record<Provider, UsageStats>,
      byModel,
      startTime,
      endTime,
    }
  }

  /**
   * Clear all usage records.
   */
  reset(): void {
    this.records = []
    // Reset threshold triggers
    for (const item of this.thresholdCallbacks) {
      item.triggered = false
    }
  }

  /**
   * Export all usage records for persistence.
   */
  exportRecords(): UsageRecord[] {
    return [...this.records]
  }

  /**
   * Import usage records (appends to existing).
   */
  importRecords(records: UsageRecord[]): void {
    this.records.push(...records)
  }
}

/**
 * Global singleton tracker instance.
 *
 * @deprecated The globalTracker singleton causes state leakage between requests
 * in multi-tenant environments. Use request-scoped tracking instead.
 *
 * **Migration Guide:**
 *
 * Instead of using globalTracker directly:
 * ```ts
 * // OLD (deprecated):
 * import { globalTracker } from '@dotdo/ai/tracking'
 * globalTracker.record({ ... })
 * const report = globalTracker.getReport()
 * ```
 *
 * Use request-scoped tracking:
 * ```ts
 * // NEW (recommended):
 * import { runWithContext, getCurrentContext } from '@dotdo/ai/context'
 *
 * // Option 1: Use runWithContext (automatic cleanup)
 * await runWithContext(async () => {
 *   const ctx = getCurrentContext()!
 *   ctx.tracker.record({ ... })
 *   const report = ctx.tracker.getReport()
 * })
 *
 * // Option 2: Create context manually
 * import { createRequestContext } from '@dotdo/ai/context'
 * const ctx = createRequestContext()
 * try {
 *   ctx.tracker.record({ ... })
 * } finally {
 *   ctx.cleanup()
 * }
 * ```
 *
 * For convenience, you can also use the request-scoped helper functions:
 * ```ts
 * import { getRequestTracker, recordUsage, getUsageReport } from '@dotdo/ai/tracking'
 *
 * // Inside runWithContext:
 * await runWithContext(async () => {
 *   recordUsage({ provider: 'openai', model: 'gpt-4o', ... })
 *   const report = getUsageReport()
 * })
 * ```
 *
 * @see do-y5xe - Fix for global mutable tracker state leakage
 */
export const globalTracker = new UsageTracker()

/**
 * Cached reference to getCurrentContext from context module.
 * Uses lazy initialization to avoid circular dependency issues.
 */
let getCurrentContextFn: (() => { tracker: UsageTracker } | undefined) | null = null

/**
 * Initialize the context getter function.
 * This should be called by the context module after it initializes.
 *
 * @internal
 */
export function _initializeContextGetter(fn: () => { tracker: UsageTracker } | undefined): void {
  getCurrentContextFn = fn
}

/**
 * Get the request-scoped tracker from the current AsyncLocalStorage context.
 *
 * Returns the tracker from the current request context if available,
 * otherwise returns undefined.
 *
 * @returns The request-scoped UsageTracker or undefined
 *
 * @example
 * ```ts
 * import { runWithContext } from '@dotdo/ai/context'
 * import { getRequestTracker } from '@dotdo/ai/tracking'
 *
 * await runWithContext(async () => {
 *   const tracker = getRequestTracker()
 *   tracker?.record({ ... })
 * })
 * ```
 */
export function getRequestTracker(): UsageTracker | undefined {
  if (!getCurrentContextFn) {
    return undefined
  }
  return getCurrentContextFn()?.tracker
}

/**
 * Get a tracker, preferring request-scoped over global.
 *
 * Returns the request-scoped tracker if available, otherwise falls back
 * to the (deprecated) globalTracker for backward compatibility.
 *
 * @returns A UsageTracker instance (request-scoped if available, global otherwise)
 *
 * @example
 * ```ts
 * import { getTracker } from '@dotdo/ai/tracking'
 *
 * // Works both inside and outside of runWithContext
 * const tracker = getTracker()
 * tracker.record({ ... })
 * ```
 */
export function getTracker(): UsageTracker {
  return getRequestTracker() ?? globalTracker
}

/**
 * Record usage in the current request context (or global tracker as fallback).
 *
 * This is a convenience function that automatically uses the request-scoped
 * tracker when available, falling back to globalTracker for backward compatibility.
 *
 * @param record - The usage record to track
 *
 * @example
 * ```ts
 * import { runWithContext } from '@dotdo/ai/context'
 * import { recordUsage } from '@dotdo/ai/tracking'
 *
 * await runWithContext(async () => {
 *   recordUsage({
 *     provider: 'openai',
 *     model: 'gpt-4o',
 *     tokens: { input: 100, output: 50 },
 *     cost: 0.001,
 *     timestamp: Date.now(),
 *   })
 * })
 * ```
 */
export function recordUsage(record: UsageRecord): void {
  getTracker().record(record)
}

/**
 * Record usage from AIMeta in the current request context (or global tracker as fallback).
 *
 * @param provider - The provider name
 * @param meta - The AIMeta object containing usage information
 *
 * @example
 * ```ts
 * import { recordUsageFromMeta } from '@dotdo/ai/tracking'
 *
 * recordUsageFromMeta('openai', aiPromise.$meta)
 * ```
 */
export function recordUsageFromMeta(provider: Provider, meta: AIMeta): void {
  getTracker().recordFromMeta(provider, meta)
}

/**
 * Get a usage report from the current request context (or global tracker as fallback).
 *
 * @param filter - Optional filter for the report
 * @returns The usage report
 *
 * @example
 * ```ts
 * import { runWithContext } from '@dotdo/ai/context'
 * import { getUsageReport } from '@dotdo/ai/tracking'
 *
 * await runWithContext(async () => {
 *   // ... make AI requests ...
 *   const report = getUsageReport()
 *   console.log(`Total cost: $${report.totalCost.toFixed(4)}`)
 * })
 * ```
 */
export function getUsageReport(filter?: ReportFilter): UsageReport {
  return getTracker().getReport(filter)
}

/**
 * Set budget limit for the current request context (or global tracker as fallback).
 *
 * @param limit - The budget limit in dollars
 *
 * @example
 * ```ts
 * import { runWithContext } from '@dotdo/ai/context'
 * import { setBudgetLimit } from '@dotdo/ai/tracking'
 *
 * await runWithContext(async () => {
 *   setBudgetLimit(5.0) // $5 limit for this request
 *   // ... make AI requests ...
 * })
 * ```
 */
export function setBudgetLimit(limit: number): void {
  getTracker().setBudgetLimit(limit)
}

/**
 * Register a budget threshold callback for the current request context.
 *
 * @param threshold - Percentage of budget (0-1) to trigger callback
 * @param callback - Function called when threshold is reached
 *
 * @example
 * ```ts
 * import { runWithContext } from '@dotdo/ai/context'
 * import { onBudgetThreshold, setBudgetLimit } from '@dotdo/ai/tracking'
 *
 * await runWithContext(async () => {
 *   setBudgetLimit(10.0)
 *   onBudgetThreshold(0.8, (cost) => {
 *     console.warn(`Warning: ${cost} of budget used`)
 *   })
 *   // ... make AI requests ...
 * })
 * ```
 */
export function onBudgetThreshold(threshold: number, callback: (currentCost: number) => void): void {
  getTracker().onBudgetThreshold(threshold, callback)
}
