/**
 * Types for @dotdo/experiments
 */

/**
 * Experiment definition stored in DO
 */
export interface ExperimentDefinition {
  /** Unique experiment identifier */
  id: string
  /** Human-readable name */
  name: string
  /** Experiment description */
  description?: string
  /** Whether the experiment is active */
  active: boolean
  /** Variants with traffic allocation */
  variants: ExperimentVariantDefinition[]
  /** Targeting rules for user inclusion */
  targeting?: TargetingRule[]
  /** Start date (Unix timestamp ms) */
  startedAt?: number
  /** End date (Unix timestamp ms) */
  endedAt?: number
  /** Experiment owner */
  owner?: string
  /** Metadata */
  metadata?: Record<string, unknown>
  /** Creation timestamp */
  createdAt: number
  /** Last update timestamp */
  updatedAt: number
}

/**
 * Variant definition within an experiment
 */
export interface ExperimentVariantDefinition {
  /** Variant identifier */
  id: string
  /** Variant name */
  name: string
  /** Traffic allocation weight (0-100) */
  weight: number
  /** Variant configuration */
  config?: Record<string, unknown>
  /** Whether this is the control variant */
  isControl?: boolean
}

/**
 * Targeting rule for experiment inclusion
 */
export interface TargetingRule {
  /** Rule type */
  type: 'percentage' | 'userIds' | 'attribute' | 'segment'
  /** Operator for comparison */
  operator?: 'equals' | 'contains' | 'in' | 'gte' | 'lte'
  /** Attribute name (for attribute rules) */
  attribute?: string
  /** Value to compare */
  value: unknown
}

/**
 * User assignment to an experiment variant
 */
export interface Assignment {
  /** User identifier */
  userId: string
  /** Experiment identifier */
  experimentId: string
  /** Assigned variant identifier */
  variantId: string
  /** Assignment timestamp */
  assignedAt: number
  /** Context at time of assignment */
  context?: Record<string, unknown> | undefined
}

/**
 * Experiment result tracking
 */
export interface ExperimentEvent {
  /** Event identifier */
  id: string
  /** Experiment identifier */
  experimentId: string
  /** Variant identifier */
  variantId: string
  /** User identifier */
  userId: string
  /** Event type */
  type: 'exposure' | 'conversion' | 'metric'
  /** Metric name (for metric events) */
  metricName?: string | undefined
  /** Metric value */
  value?: number | undefined
  /** Event timestamp */
  timestamp: number
  /** Additional properties */
  properties?: Record<string, unknown> | undefined
}

/**
 * Aggregated variant statistics
 */
export interface VariantStats {
  /** Variant identifier */
  variantId: string
  /** Number of users exposed */
  exposures: number
  /** Number of conversions */
  conversions: number
  /** Conversion rate */
  conversionRate: number
  /** Sum of metric values */
  metricSum: number
  /** Mean metric value */
  metricMean: number
  /** Standard deviation */
  metricStdDev: number
  /** Confidence interval (95%) */
  confidenceInterval: [number, number]
}

/**
 * Statistical significance result
 */
export interface SignificanceResult {
  /** Whether the result is statistically significant */
  isSignificant: boolean
  /** p-value */
  pValue: number
  /** Confidence level (e.g., 0.95) */
  confidenceLevel: number
  /** Effect size (relative improvement) */
  effectSize: number
  /** Minimum detectable effect */
  minimumDetectableEffect?: number
  /** Required sample size for significance */
  requiredSampleSize?: number
  /** Power of the test */
  power?: number
  /** Control stats */
  control: VariantStats
  /** Treatment stats */
  treatment: VariantStats
}

/**
 * Feature flag definition
 */
export interface FeatureFlagDefinition {
  /** Flag key */
  key: string
  /** Human-readable name */
  name: string
  /** Flag description */
  description?: string
  /** Whether the flag is enabled */
  enabled: boolean
  /** Value type */
  type: 'boolean' | 'string' | 'number' | 'json'
  /** Default value */
  defaultValue: boolean | string | number | Record<string, unknown>
  /** Targeting rules */
  rules?: FeatureFlagRule[]
  /** Metadata */
  metadata?: Record<string, unknown>
  /** Creation timestamp */
  createdAt: number
  /** Last update timestamp */
  updatedAt: number
}

/**
 * Feature flag targeting rule
 */
export interface FeatureFlagRule {
  /** Rule identifier */
  id: string
  /** Rule conditions */
  conditions: FeatureFlagCondition[]
  /** Value to return if rule matches */
  value: boolean | string | number | Record<string, unknown>
  /** Percentage rollout (0-100) */
  percentage?: number
  /** Rule priority (lower = higher priority) */
  priority: number
}

/**
 * Condition for feature flag evaluation
 */
export interface FeatureFlagCondition {
  /** Attribute to evaluate */
  attribute: string
  /** Comparison operator */
  operator: 'equals' | 'notEquals' | 'contains' | 'in' | 'notIn' | 'gte' | 'lte' | 'regex'
  /** Value to compare against */
  value: unknown
}

/**
 * Feature flag evaluation context
 */
export interface EvaluationContext {
  /** User identifier */
  userId?: string
  /** User attributes */
  attributes?: Record<string, unknown>
  /** Session identifier */
  sessionId?: string
  /** Request metadata */
  requestMetadata?: Record<string, unknown>
}

/**
 * Feature flag evaluation result
 */
export interface EvaluationResult<T = unknown> {
  /** Evaluated value */
  value: T
  /** Rule that matched (if any) */
  matchedRule?: string
  /** Whether the flag was found */
  found: boolean
  /** Evaluation timestamp */
  evaluatedAt: number
}

/**
 * DO Storage interface for experiments
 */
export interface ExperimentStorage {
  /** Get all storage (for DO backing) */
  get<T>(key: string): Promise<T | undefined>
  get<T>(keys: string[]): Promise<Map<string, T>>
  /** Put value to storage */
  put<T>(key: string, value: T): Promise<void>
  put<T>(entries: Map<string, T>): Promise<void>
  /** Delete from storage */
  delete(key: string): Promise<boolean>
  delete(keys: string[]): Promise<number>
  /** List keys with prefix */
  list<T>(options?: { prefix?: string; limit?: number; start?: string; end?: string }): Promise<Map<string, T>>
}
