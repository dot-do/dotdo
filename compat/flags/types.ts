/**
 * Feature Flags Types
 *
 * OpenFeature-compatible type definitions for feature flags.
 *
 * @module @dotdo/compat/flags/types
 */

// ============================================================================
// TARGETING OPERATORS
// ============================================================================

/**
 * Supported targeting operators for flag evaluation
 */
export type TargetingOperator =
  | 'in'
  | 'startsWith'
  | 'endsWith'
  | 'matches'
  | 'contains'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'semVerEqual'
  | 'semVerLessThan'
  | 'semVerGreaterThan'

// ============================================================================
// EVALUATION TYPES
// ============================================================================

/**
 * Reasons for flag evaluation result
 */
export type EvaluationReason =
  | 'STATIC'
  | 'DEFAULT'
  | 'TARGETING_MATCH'
  | 'SPLIT'
  | 'CACHED'
  | 'DISABLED'
  | 'ERROR'

/**
 * Error codes for flag evaluation failures
 */
export type ErrorCode =
  | 'PROVIDER_NOT_READY'
  | 'FLAG_NOT_FOUND'
  | 'PARSE_ERROR'
  | 'TYPE_MISMATCH'
  | 'TARGETING_KEY_MISSING'
  | 'GENERAL'

/**
 * Context for flag evaluation
 */
export interface EvaluationContext {
  /** Primary targeting key (usually user ID) */
  targetingKey?: string
  /** Custom attributes for targeting */
  [key: string]: unknown
}

/**
 * Details of a flag evaluation result
 */
export interface EvaluationDetails<T> {
  /** The evaluated flag value */
  value: T
  /** Reason for the evaluation result */
  reason: EvaluationReason
  /** Index of the variation (if applicable) */
  variant?: number
  /** Error code if evaluation failed */
  errorCode?: ErrorCode
  /** Human-readable error message */
  errorMessage?: string
  /** Additional flag metadata */
  flagMetadata?: Record<string, unknown>
}

// ============================================================================
// FLAG VARIATION
// ============================================================================

/**
 * A single variation of a flag value
 */
export interface FlagVariation<T> {
  /** The variation value */
  value: T
  /** Human-readable label for the variation */
  label?: string
  /** Weight for percentage rollouts (0-100) */
  weight?: number
}

// ============================================================================
// TARGETING
// ============================================================================

/**
 * A single targeting clause (condition)
 */
export interface TargetingClause {
  /** Context kind to evaluate against (default: 'user') */
  contextKind?: string
  /** The attribute to evaluate */
  attribute: string
  /** The comparison operator */
  operator: TargetingOperator
  /** Values to compare against */
  values: unknown[]
  /** Negate the clause result */
  negate?: boolean
}

/**
 * Rollout configuration for percentage-based feature distribution
 */
export interface Rollout<T> {
  /** Variations with their weights */
  variations: FlagVariation<T>[]
  /** Attribute to use for consistent bucketing */
  bucketBy?: string
  /** Seed for hash function (for consistent bucketing) */
  seed?: number
}

/**
 * A targeting rule that determines flag value based on context
 */
export interface TargetingRule<T> {
  /** Unique identifier for the rule */
  id: string
  /** Human-readable description */
  description?: string
  /** Clauses that must all match (AND logic) */
  clauses: TargetingClause[]
  /** Fixed variation value (mutually exclusive with rollout) */
  variation?: T
  /** Percentage rollout (mutually exclusive with variation) */
  rollout?: Rollout<T>
}

// ============================================================================
// FLAG DEFINITION
// ============================================================================

/**
 * Prerequisite flag that must be satisfied
 */
export interface FlagPrerequisite {
  /** The prerequisite flag key */
  key: string
  /** Required variation value */
  variation: unknown
}

/**
 * Complete flag definition
 */
export interface FlagDefinition<T> {
  /** Unique flag key */
  key: string
  /** Default value when no rules match */
  defaultValue: T
  /** Human-readable description */
  description?: string
  /** Available variations */
  variations?: FlagVariation<T>[]
  /** Targeting rules (evaluated in order) */
  targeting?: TargetingRule<T>[]
  /** Prerequisite flags that must be satisfied */
  prerequisites?: FlagPrerequisite[]
  /** Tags for organization */
  tags?: string[]
  /** Whether this is a temporary flag */
  temporary?: boolean
}

// ============================================================================
// FLAG PROVIDER (OpenFeature Compatible)
// ============================================================================

/**
 * OpenFeature-compatible flag provider interface
 */
export interface FlagProvider {
  /** Provider metadata */
  metadata: {
    name: string
  }

  /** Resolve a boolean flag */
  resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    context?: EvaluationContext
  ): Promise<EvaluationDetails<boolean>>

  /** Resolve a string flag */
  resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
    context?: EvaluationContext
  ): Promise<EvaluationDetails<string>>

  /** Resolve a number flag */
  resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number,
    context?: EvaluationContext
  ): Promise<EvaluationDetails<number>>

  /** Resolve an object flag */
  resolveObjectEvaluation<T extends object>(
    flagKey: string,
    defaultValue: T,
    context?: EvaluationContext
  ): Promise<EvaluationDetails<T>>
}

// ============================================================================
// VALIDATORS
// ============================================================================

/**
 * Check if a value is a valid flag definition
 */
export function isValidFlagDefinition(value: unknown): value is FlagDefinition<unknown> {
  if (!value || typeof value !== 'object') {
    return false
  }

  const obj = value as Record<string, unknown>

  // Required fields
  if (typeof obj.key !== 'string' || obj.key.trim() === '') {
    return false
  }

  if (!('defaultValue' in obj)) {
    return false
  }

  return true
}

/**
 * Check if a value is a valid evaluation context
 */
export function isValidEvaluationContext(value: unknown): value is EvaluationContext {
  if (value === null || value === undefined) {
    return false
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  return true
}

/**
 * Check if a value is a valid targeting rule
 */
export function isValidTargetingRule(value: unknown): value is TargetingRule<unknown> {
  if (!value || typeof value !== 'object') {
    return false
  }

  const obj = value as Record<string, unknown>

  // Required fields
  if (typeof obj.id !== 'string') {
    return false
  }

  if (!Array.isArray(obj.clauses)) {
    return false
  }

  // Must have either variation or rollout
  if (!('variation' in obj) && !('rollout' in obj)) {
    return false
  }

  return true
}
