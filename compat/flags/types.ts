/**
 * Feature Flags Types
 *
 * OpenFeature-compatible type definitions for feature flags with full
 * LaunchDarkly data model compatibility.
 *
 * @example Basic boolean flag
 * ```ts
 * const flag: FlagDefinition<boolean> = {
 *   key: 'dark-mode',
 *   defaultValue: false,
 *   description: 'Enable dark mode for users',
 * }
 * ```
 *
 * @example Flag with targeting rules
 * ```ts
 * const flag: FlagDefinition<boolean> = {
 *   key: 'beta-feature',
 *   defaultValue: false,
 *   targeting: [{
 *     id: 'beta-users',
 *     clauses: [{
 *       attribute: 'email',
 *       operator: 'endsWith',
 *       values: ['@company.com'],
 *     }],
 *     variation: true,
 *   }],
 * }
 * ```
 *
 * @example Using FlagBuilder
 * ```ts
 * const flag = FlagBuilder.boolean('new-feature')
 *   .description('A new feature')
 *   .targeting('internal-users', clause => clause
 *     .attribute('email')
 *     .endsWith('@company.com'))
 *   .enable()
 *   .build()
 * ```
 *
 * @module @dotdo/compat/flags/types
 */

// ============================================================================
// TARGETING OPERATORS
// ============================================================================

/**
 * Supported targeting operators for flag evaluation.
 *
 * These operators are compatible with LaunchDarkly's targeting rules and
 * OpenFeature's evaluation model.
 *
 * @example Membership check
 * ```ts
 * const clause: TargetingClause = {
 *   attribute: 'country',
 *   operator: 'in',
 *   values: ['US', 'CA', 'UK'],
 * }
 * ```
 *
 * @example Semantic versioning
 * ```ts
 * const clause: TargetingClause = {
 *   attribute: 'appVersion',
 *   operator: 'semVerGreaterThan',
 *   values: ['2.0.0'],
 * }
 * ```
 */
export type TargetingOperator =
  // Membership operators
  | 'in'
  | 'notIn'
  // String operators
  | 'startsWith'
  | 'endsWith'
  | 'matches'
  | 'contains'
  // Numeric operators
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  // Date operators
  | 'before'
  | 'after'
  // Semantic version operators
  | 'semVerEqual'
  | 'semVerLessThan'
  | 'semVerGreaterThan'
  // Segment operator
  | 'segmentMatch'

// ============================================================================
// EVALUATION TYPES
// ============================================================================

/**
 * Reasons for flag evaluation result.
 *
 * These reasons help explain why a particular flag value was returned,
 * useful for debugging and analytics.
 *
 * @example
 * ```ts
 * const details: EvaluationDetails<boolean> = {
 *   value: true,
 *   reason: 'TARGETING_MATCH',
 *   variant: 1,
 * }
 * console.log(`Flag returned ${details.value} due to ${details.reason}`)
 * ```
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
 * Error codes for flag evaluation failures.
 *
 * These codes follow OpenFeature error code conventions.
 *
 * @example Error handling
 * ```ts
 * const result = await provider.resolveBooleanEvaluation('my-flag', false, context)
 * if (result.errorCode) {
 *   switch (result.errorCode) {
 *     case 'FLAG_NOT_FOUND':
 *       console.error(`Flag ${flagKey} does not exist`)
 *       break
 *     case 'TYPE_MISMATCH':
 *       console.error(`Flag ${flagKey} is not a boolean`)
 *       break
 *   }
 * }
 * ```
 */
export type ErrorCode =
  | 'PROVIDER_NOT_READY'
  | 'FLAG_NOT_FOUND'
  | 'PARSE_ERROR'
  | 'TYPE_MISMATCH'
  | 'TARGETING_KEY_MISSING'
  | 'GENERAL'

/**
 * Context for flag evaluation.
 *
 * The evaluation context provides attributes about the user, device, or
 * environment that can be used in targeting rules.
 *
 * @example User context
 * ```ts
 * const context: EvaluationContext = {
 *   targetingKey: 'user-123',
 *   email: 'user@example.com',
 *   plan: 'premium',
 *   country: 'US',
 * }
 * ```
 *
 * @example Organization context
 * ```ts
 * const context: EvaluationContext = {
 *   targetingKey: 'org-456',
 *   company: {
 *     name: 'Acme Inc',
 *     employees: 500,
 *     plan: 'enterprise',
 *   },
 * }
 * ```
 */
export interface EvaluationContext {
  /** Primary targeting key (usually user ID) */
  targetingKey?: string
  /** Custom attributes for targeting */
  [key: string]: unknown
}

/**
 * Details of a flag evaluation result.
 *
 * Contains the evaluated value along with metadata about how the
 * evaluation was performed.
 *
 * @example Successful evaluation
 * ```ts
 * const details: EvaluationDetails<boolean> = {
 *   value: true,
 *   reason: 'TARGETING_MATCH',
 *   variant: 1,
 *   flagMetadata: { version: 5 },
 * }
 * ```
 *
 * @example Error case
 * ```ts
 * const details: EvaluationDetails<boolean> = {
 *   value: false, // default value
 *   reason: 'ERROR',
 *   errorCode: 'FLAG_NOT_FOUND',
 *   errorMessage: 'Flag "unknown-flag" not found',
 * }
 * ```
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
 * A single variation of a flag value.
 *
 * Variations represent the possible values a flag can have. In simple cases,
 * a boolean flag has two variations (true/false). For more complex flags,
 * you can define multiple variations with labels and weights.
 *
 * @example Boolean variations
 * ```ts
 * const variations: FlagVariation<boolean>[] = [
 *   { value: false, label: 'Disabled' },
 *   { value: true, label: 'Enabled' },
 * ]
 * ```
 *
 * @example A/B test variations with weights
 * ```ts
 * const variations: FlagVariation<string>[] = [
 *   { value: 'control', label: 'Control', weight: 50 },
 *   { value: 'treatment-a', label: 'Treatment A', weight: 25 },
 *   { value: 'treatment-b', label: 'Treatment B', weight: 25 },
 * ]
 * ```
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
 * A single targeting clause (condition).
 *
 * Targeting clauses define conditions that must be met for a targeting
 * rule to match. Multiple clauses in a rule are combined with AND logic.
 *
 * @example Email domain check
 * ```ts
 * const clause: TargetingClause = {
 *   attribute: 'email',
 *   operator: 'endsWith',
 *   values: ['@company.com', '@partner.com'],
 * }
 * ```
 *
 * @example Country exclusion
 * ```ts
 * const clause: TargetingClause = {
 *   attribute: 'country',
 *   operator: 'in',
 *   values: ['US', 'CA'],
 *   negate: true, // NOT in US or CA
 * }
 * ```
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
 * Rollout configuration for percentage-based feature distribution.
 *
 * Rollouts allow you to gradually release features to a percentage of users
 * while maintaining consistent bucketing (the same user always gets the
 * same variation).
 *
 * @example 50/50 A/B test
 * ```ts
 * const rollout: Rollout<string> = {
 *   variations: [
 *     { value: 'control', weight: 50 },
 *     { value: 'treatment', weight: 50 },
 *   ],
 *   bucketBy: 'userId',
 * }
 * ```
 *
 * @example Gradual rollout
 * ```ts
 * const rollout: Rollout<boolean> = {
 *   variations: [
 *     { value: false, weight: 90 },
 *     { value: true, weight: 10 },  // 10% rollout
 *   ],
 *   seed: 12345, // deterministic bucketing
 * }
 * ```
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
 * A targeting rule that determines flag value based on context.
 *
 * Targeting rules are evaluated in order. When all clauses in a rule match,
 * the rule's variation (or rollout) is returned.
 *
 * @example Enable for beta users
 * ```ts
 * const rule: TargetingRule<boolean> = {
 *   id: 'beta-users',
 *   description: 'Enable for beta testers',
 *   clauses: [{
 *     attribute: 'tags',
 *     operator: 'contains',
 *     values: ['beta'],
 *   }],
 *   variation: true,
 * }
 * ```
 *
 * @example A/B test for enterprise users
 * ```ts
 * const rule: TargetingRule<string> = {
 *   id: 'enterprise-ab-test',
 *   clauses: [{
 *     attribute: 'plan',
 *     operator: 'in',
 *     values: ['enterprise'],
 *   }],
 *   rollout: {
 *     variations: [
 *       { value: 'control', weight: 50 },
 *       { value: 'treatment', weight: 50 },
 *     ],
 *   },
 * }
 * ```
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
