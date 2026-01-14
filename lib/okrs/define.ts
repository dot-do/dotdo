/**
 * OKR Definition Functions
 *
 * Provides factory functions for creating typed OKR and Metric objects:
 * - defineOKR(): Create an OKR with progress tracking and completion checking
 * - defineMetric(): Create a reusable metric definition with optional measurement function
 *
 * @example
 * const okr = defineOKR({
 *   objective: 'Increase user engagement',
 *   keyResults: [
 *     { metric: 'DailyActiveUsers', target: 5000, current: 3000 },
 *     { metric: 'SessionDuration', target: 15, current: 10 },
 *   ],
 * })
 *
 * console.log(okr.progress()) // 0.55
 * console.log(okr.isComplete()) // false
 */

import type { KeyResult, MeasurementFunction } from './types'

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for creating an OKR via defineOKR()
 */
export interface OKRConfig {
  /** The strategic objective to achieve */
  objective: string
  /** Array of key results that measure progress toward the objective */
  keyResults: OKRKeyResultConfig[]
}

/**
 * KeyResult configuration with optional current value (defaults to 0)
 */
export interface OKRKeyResultConfig {
  /** The metric name (PascalCase convention) */
  metric: string
  /** The target value to achieve */
  target: number
  /** The current value (defaults to 0) */
  current?: number
  /** Optional measurement function */
  measurement?: MeasurementFunction
}

/**
 * An OKR object with progress tracking methods
 */
export interface OKR {
  /** The strategic objective */
  objective: string
  /** Array of key results */
  keyResults: KeyResult[]
  /** Calculate average progress across all key results (0-1) */
  progress(): number
  /** Check if all key results have met their targets */
  isComplete(): boolean
}

/**
 * Configuration for creating a Metric via defineMetric()
 */
export interface MetricConfig {
  /** The metric name (PascalCase convention) */
  name: string
  /** Optional measurement function to retrieve current value */
  measurement?: MeasurementFunction
}

/**
 * A Metric definition with name and optional measurement
 */
export interface MetricDefinition {
  /** The metric name */
  name: string
  /** Optional measurement function */
  measurement?: MeasurementFunction
}

// ============================================================================
// Prebuilt Metric Types (Extended for pre-built OKRs)
// ============================================================================

/**
 * Analytics context type for prebuilt metric measurement functions.
 * Provides access to various analytics namespaces.
 */
export interface AnalyticsContext {
  product: {
    featureAdoptionRate: number
    userSatisfactionScore: number
    onboardingCompletionTime: number
    [key: string]: number
  }
  web?: {
    [key: string]: number
  }
  financial: {
    /** Monthly Recurring Revenue */
    mrr: number
    /** Monthly Churn Rate (%) */
    churn: number
    /** Net Revenue Retention (%) */
    nrr: number
    /** Customer Acquisition Cost */
    cac: number
    /** Customer Lifetime Value */
    ltv: number
    [key: string]: number
  }
  engineering?: {
    /** Story points delivered per sprint */
    storyPointsPerSprint: number
    /** Combined test coverage and lint score (%) */
    codeQualityScore: number
    /** System uptime percentage */
    uptimePercentage: number
    /** PRs reviewed per week */
    prsReviewedPerWeek: number
    [key: string]: number
  }
  growth?: {
    [key: string]: number
  }
  sales?: {
    /** Number of qualified opportunities in pipeline */
    qualifiedOpportunities: number
    /** Demo to close conversion rate (%) */
    demoToCloseRate: number
    /** MRR/ARR growth rate (%) */
    revenueGrowthRate: number
    [key: string]: number
  }
  support: {
    /** Average first response time in minutes */
    firstResponseTime: number
    /** % of tickets resolved without escalation */
    resolutionRate: number
    /** Customer satisfaction score (typically 1-5) */
    csat: number
    [key: string]: number
  }
  customerSuccess: {
    /** Net Revenue Retention (%) */
    netRetentionRate: number
    /** Upsell/cross-sell revenue */
    expansionRevenue: number
    /** At-risk accounts saved from churning */
    savedAccounts: number
    [key: string]: number
  }
  [key: string]: Record<string, number> | undefined
}

/**
 * Configuration for creating a prebuilt Metric with description, unit, and analytics-aware measurement
 */
export interface PrebuiltMetricConfig {
  /** The metric name (PascalCase convention) */
  name: string
  /** Human-readable description of what this metric measures */
  description: string
  /** The unit of measurement (e.g., '%', 'score', 'minutes', 'count') */
  unit: string
  /** Measurement function that computes the metric value from analytics data */
  measurement: (analytics: AnalyticsContext) => number | Promise<number>
}

/**
 * A prebuilt metric definition with all required properties
 */
export interface PrebuiltMetric {
  /** The metric name */
  readonly name: string
  /** Human-readable description */
  readonly description: string
  /** The unit of measurement */
  readonly unit: string
  /** Measurement function that takes analytics context */
  readonly measurement: (analytics: AnalyticsContext) => number | Promise<number>
}

// ============================================================================
// defineOKR()
// ============================================================================

/**
 * Create a typed OKR object with progress tracking methods.
 *
 * @param config - The OKR configuration with objective and key results
 * @returns An OKR object with progress() and isComplete() methods
 *
 * @example
 * const okr = defineOKR({
 *   objective: 'Launch MVP successfully',
 *   keyResults: [
 *     { metric: 'ActiveUsers', target: 1000, current: 500 },
 *     { metric: 'Revenue', target: 10000 }, // current defaults to 0
 *   ],
 * })
 *
 * okr.progress()    // Returns 0.25 (average of 50% and 0%)
 * okr.isComplete()  // Returns false
 */
export function defineOKR(config: OKRConfig): OKR {
  // Map key results, defaulting current to 0 if not provided
  const keyResults: KeyResult[] = config.keyResults.map((kr) => ({
    metric: kr.metric,
    target: kr.target,
    current: kr.current ?? 0,
    measurement: kr.measurement,
  }))

  return {
    objective: config.objective,
    keyResults,

    /**
     * Calculate the average progress across all key results.
     * Progress for each KR is calculated as current / target, capped at 1.
     * If target is 0 and current is 0, that KR is considered complete (1).
     *
     * @returns Progress value between 0 and 1
     */
    progress(): number {
      if (keyResults.length === 0) {
        return 0
      }

      const totalProgress = keyResults.reduce((sum, kr) => {
        // Handle zero target: if target and current are both 0, consider it complete
        if (kr.target === 0) {
          return sum + (kr.current === 0 ? 1 : 0)
        }

        // Calculate progress, capped at 1 (100%)
        const krProgress = Math.min(kr.current / kr.target, 1)
        return sum + krProgress
      }, 0)

      return totalProgress / keyResults.length
    },

    /**
     * Check if all key results have met or exceeded their targets.
     *
     * @returns true if all KRs are complete, false otherwise
     */
    isComplete(): boolean {
      if (keyResults.length === 0) {
        return true
      }

      return keyResults.every((kr) => kr.current >= kr.target)
    },
  }
}

// ============================================================================
// defineMetric()
// ============================================================================

/**
 * Create a reusable metric definition.
 *
 * Supports two forms:
 * 1. Simple: name + optional measurement function (legacy)
 * 2. Prebuilt: name + description + unit + analytics-aware measurement (for pre-built OKRs)
 *
 * @example Simple metric
 * ```typescript
 * const revenueMetric = defineMetric({
 *   name: 'MonthlyRevenue',
 *   measurement: async () => await fetchRevenueFromAPI(),
 * })
 * ```
 *
 * @example Prebuilt metric with analytics context
 * ```typescript
 * const FeatureAdoption = defineMetric({
 *   name: 'FeatureAdoption',
 *   description: '% users using new features',
 *   unit: '%',
 *   measurement: async (analytics) => analytics.product.featureAdoptionRate,
 * })
 * ```
 */
export function defineMetric(config: PrebuiltMetricConfig): PrebuiltMetric
export function defineMetric(config: MetricConfig): MetricDefinition
export function defineMetric(config: MetricConfig | PrebuiltMetricConfig): MetricDefinition | PrebuiltMetric {
  // Check if this is a prebuilt metric config (has description and unit)
  if ('description' in config && 'unit' in config) {
    return Object.freeze({
      name: config.name,
      description: config.description,
      unit: config.unit,
      measurement: config.measurement,
    }) as PrebuiltMetric
  }

  // Simple metric config
  return {
    name: config.name,
    measurement: config.measurement,
  }
}
