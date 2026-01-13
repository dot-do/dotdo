/**
 * Feature Flag Evaluator
 *
 * Provides feature flag evaluation with:
 * - Boolean and multivariate flags (string, number, JSON)
 * - User targeting (attributes, segments)
 * - Environment-based evaluation
 * - Percentage rollout with consistent bucketing
 * - Flag dependencies (prerequisites)
 * - Evaluation logging
 * - Type safety
 * - Stale flag detection
 *
 * RED PHASE: This is a stub implementation for TDD.
 * All methods throw NotImplementedError until implementation is complete.
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Flag type determines the value type returned by evaluation
 */
export type FlagType = 'boolean' | 'string' | 'number' | 'json'

/**
 * Stickiness determines how users are consistently bucketed
 */
export type Stickiness = 'userId' | 'sessionId' | 'random'

/**
 * Reason for flag evaluation result
 */
export type EvaluationReason =
  | 'MATCH'
  | 'FLAG_NOT_FOUND'
  | 'FLAG_DISABLED'
  | 'FLAG_EXPIRED'
  | 'NOT_IN_ROLLOUT'
  | 'KILL_SWITCH'
  | 'ENVIRONMENT_MISMATCH'
  | 'PREREQUISITE_NOT_MET'
  | 'DEFAULT'

/**
 * Comparison operators for targeting rules
 */
export type Operator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'in'
  | 'notIn'
  | 'greaterThan'
  | 'lessThan'
  | 'greaterThanOrEquals'
  | 'lessThanOrEquals'

/**
 * A single condition in a targeting rule
 */
export interface RuleCondition {
  attribute?: string
  operator?: Operator
  value?: unknown
  segment?: string
}

/**
 * A targeting rule with conditions and resulting value
 */
export interface TargetingRule {
  conditions: RuleCondition[]
  value: unknown
}

/**
 * A flag variant with key, value, and weight
 */
export interface FlagVariant<T = unknown> {
  key: string
  value: T
  weight: number
}

/**
 * A prerequisite dependency on another flag
 */
export interface FlagPrerequisite {
  flagKey: string
  value: unknown
}

/**
 * Complete flag definition
 */
export interface FlagDefinition<T = unknown> {
  key: string
  type: FlagType
  enabled: boolean
  defaultValue: T
  variants?: FlagVariant<T>[]
  rules?: TargetingRule[]
  prerequisites?: FlagPrerequisite[]
  rolloutPercentage?: number
  stickiness?: Stickiness
  environments?: string[]
  environmentValues?: Record<string, T>
  expiresAt?: string
  disableLogging?: boolean
}

/**
 * Context for flag evaluation
 */
export interface EvaluationContext {
  userId: string
  sessionId?: string
  attributes: Record<string, unknown>
  segments: string[]
}

/**
 * Options for a single evaluation
 */
export interface EvaluationOptions {
  defaultValue?: unknown
}

/**
 * Result of a flag evaluation
 */
export interface EvaluationResult<T = unknown> {
  flagKey: string
  value: T
  variant?: string
  reason: EvaluationReason
  bucket?: number
}

/**
 * Log entry for flag evaluation
 */
export interface EvaluationLog {
  flagKey: string
  userId: string
  value: unknown
  variant?: string
  reason: EvaluationReason
  timestamp: number
  evaluationLatencyMs?: number
}

/**
 * Store interface for persistence and logging
 */
export interface FlagStore {
  log?: (entry: EvaluationLog) => Promise<void>
  logBatch?: (entries: EvaluationLog[]) => Promise<void>
  onStaleFlagEvaluated?: (flag: FlagDefinition) => void
}

/**
 * Configuration for the flag evaluator
 */
export interface FlagEvaluatorConfig {
  flags?: FlagDefinition[]
  store?: FlagStore
  environment?: string
  killSwitch?: boolean
}

// ============================================================================
// FLAG EVALUATOR CLASS
// ============================================================================

/**
 * FlagEvaluator provides feature flag evaluation
 *
 * RED PHASE: All methods throw NotImplementedError
 */
export class FlagEvaluator {
  constructor(_config?: FlagEvaluatorConfig) {
    throw new Error('FlagEvaluator: Not implemented')
  }

  /**
   * Evaluate a flag and return the result
   */
  async evaluate<T = unknown>(
    _flagKey: string,
    _context: EvaluationContext,
    _options?: EvaluationOptions
  ): Promise<EvaluationResult<T>> {
    throw new Error('evaluate: Not implemented')
  }

  /**
   * Get a boolean flag value
   */
  async getBooleanValue(
    _flagKey: string,
    _context: EvaluationContext,
    _defaultValue: boolean
  ): Promise<boolean> {
    throw new Error('getBooleanValue: Not implemented')
  }

  /**
   * Get a string flag value
   */
  async getStringValue(
    _flagKey: string,
    _context: EvaluationContext,
    _defaultValue: string
  ): Promise<string> {
    throw new Error('getStringValue: Not implemented')
  }

  /**
   * Get a number flag value
   */
  async getNumberValue(
    _flagKey: string,
    _context: EvaluationContext,
    _defaultValue: number
  ): Promise<number> {
    throw new Error('getNumberValue: Not implemented')
  }

  /**
   * Get a JSON flag value
   */
  async getJsonValue<T = unknown>(
    _flagKey: string,
    _context: EvaluationContext,
    _defaultValue: T
  ): Promise<T> {
    throw new Error('getJsonValue: Not implemented')
  }

  /**
   * Update a flag at runtime
   */
  async setFlag(_flagKey: string, _updates: Partial<FlagDefinition>): Promise<void> {
    throw new Error('setFlag: Not implemented')
  }

  /**
   * Enable or disable the kill switch
   */
  setKillSwitch(_enabled: boolean): void {
    throw new Error('setKillSwitch: Not implemented')
  }

  /**
   * Set the current environment
   */
  setEnvironment(_environment: string): void {
    throw new Error('setEnvironment: Not implemented')
  }

  /**
   * Get all stale (expired) flags
   */
  getStaleFlags(): FlagDefinition[] {
    throw new Error('getStaleFlags: Not implemented')
  }

  /**
   * Get flags expiring within the given time window
   */
  getFlagsExpiringSoon(_withinMs: number): FlagDefinition[] {
    throw new Error('getFlagsExpiringSoon: Not implemented')
  }

  /**
   * Get time until a flag expires (negative if already expired)
   */
  getTimeUntilExpiry(_flagKey: string): number {
    throw new Error('getTimeUntilExpiry: Not implemented')
  }

  /**
   * Flush pending evaluation logs
   */
  async flush(): Promise<void> {
    throw new Error('flush: Not implemented')
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new FlagEvaluator instance
 */
export function createFlagEvaluator(config?: FlagEvaluatorConfig): FlagEvaluator {
  return new FlagEvaluator(config)
}
