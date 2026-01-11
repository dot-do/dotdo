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
 *   email: 'user@example.com.ai',
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

/**
 * Check if a value is a valid flag variation
 *
 * @example
 * ```ts
 * const variation = { value: 'control', weight: 50 }
 * if (isFlagVariation(variation)) {
 *   console.log(`Value: ${variation.value}`)
 * }
 * ```
 */
export function isFlagVariation(value: unknown): value is FlagVariation<unknown> {
  if (!value || typeof value !== 'object') {
    return false
  }

  const obj = value as Record<string, unknown>

  // Must have value field
  if (!('value' in obj)) {
    return false
  }

  // Optional label must be string if present
  if ('label' in obj && typeof obj.label !== 'string') {
    return false
  }

  // Optional weight must be number if present
  if ('weight' in obj && typeof obj.weight !== 'number') {
    return false
  }

  return true
}

/**
 * Check if a value is a valid targeting clause
 *
 * @example
 * ```ts
 * const clause = { attribute: 'email', operator: 'endsWith', values: ['@company.com'] }
 * if (isTargetingClause(clause)) {
 *   console.log(`Checking attribute: ${clause.attribute}`)
 * }
 * ```
 */
export function isTargetingClause(value: unknown): value is TargetingClause {
  if (!value || typeof value !== 'object') {
    return false
  }

  const obj = value as Record<string, unknown>

  // Required fields
  if (typeof obj.attribute !== 'string') {
    return false
  }

  if (typeof obj.operator !== 'string') {
    return false
  }

  if (!Array.isArray(obj.values)) {
    return false
  }

  return true
}

/**
 * Check if a value is a valid rollout configuration
 *
 * @example
 * ```ts
 * const rollout = { variations: [{ value: 'a', weight: 50 }, { value: 'b', weight: 50 }] }
 * if (isRollout(rollout)) {
 *   console.log(`Rollout has ${rollout.variations.length} variations`)
 * }
 * ```
 */
export function isRollout(value: unknown): value is Rollout<unknown> {
  if (!value || typeof value !== 'object') {
    return false
  }

  const obj = value as Record<string, unknown>

  // Required variations array
  if (!Array.isArray(obj.variations)) {
    return false
  }

  // All variations must be valid
  for (const v of obj.variations) {
    if (!isFlagVariation(v)) {
      return false
    }
  }

  // Optional bucketBy must be string if present
  if ('bucketBy' in obj && typeof obj.bucketBy !== 'string') {
    return false
  }

  // Optional seed must be number if present
  if ('seed' in obj && typeof obj.seed !== 'number') {
    return false
  }

  return true
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validation result with detailed error information
 */
export interface ValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Validate a flag definition with detailed error messages
 *
 * @example
 * ```ts
 * const result = validateFlagDefinition(flag)
 * if (!result.valid) {
 *   console.error('Validation errors:', result.errors)
 * }
 * ```
 */
export function validateFlagDefinition(value: unknown): ValidationResult {
  const errors: string[] = []

  if (!value || typeof value !== 'object') {
    return { valid: false, errors: ['Flag definition must be an object'] }
  }

  const obj = value as Record<string, unknown>

  // Key validation
  if (!('key' in obj)) {
    errors.push('Missing required field: key')
  } else if (typeof obj.key !== 'string') {
    errors.push('Field "key" must be a string')
  } else if (obj.key.trim() === '') {
    errors.push('Field "key" cannot be empty')
  }

  // Default value validation
  if (!('defaultValue' in obj)) {
    errors.push('Missing required field: defaultValue')
  }

  // Optional description validation
  if ('description' in obj && typeof obj.description !== 'string') {
    errors.push('Field "description" must be a string')
  }

  // Optional variations validation
  if ('variations' in obj) {
    if (!Array.isArray(obj.variations)) {
      errors.push('Field "variations" must be an array')
    } else {
      obj.variations.forEach((v, i) => {
        if (!isFlagVariation(v)) {
          errors.push(`Invalid variation at index ${i}`)
        }
      })
    }
  }

  // Optional targeting validation
  if ('targeting' in obj) {
    if (!Array.isArray(obj.targeting)) {
      errors.push('Field "targeting" must be an array')
    } else {
      obj.targeting.forEach((rule, i) => {
        if (!isValidTargetingRule(rule)) {
          errors.push(`Invalid targeting rule at index ${i}`)
        }
      })
    }
  }

  // Optional tags validation
  if ('tags' in obj) {
    if (!Array.isArray(obj.tags)) {
      errors.push('Field "tags" must be an array')
    } else if (!obj.tags.every(t => typeof t === 'string')) {
      errors.push('All tags must be strings')
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Validate a targeting clause with detailed error messages
 */
export function validateTargetingClause(value: unknown): ValidationResult {
  const errors: string[] = []

  if (!value || typeof value !== 'object') {
    return { valid: false, errors: ['Targeting clause must be an object'] }
  }

  const obj = value as Record<string, unknown>

  if (!('attribute' in obj)) {
    errors.push('Missing required field: attribute')
  } else if (typeof obj.attribute !== 'string') {
    errors.push('Field "attribute" must be a string')
  }

  if (!('operator' in obj)) {
    errors.push('Missing required field: operator')
  } else if (typeof obj.operator !== 'string') {
    errors.push('Field "operator" must be a string')
  }

  if (!('values' in obj)) {
    errors.push('Missing required field: values')
  } else if (!Array.isArray(obj.values)) {
    errors.push('Field "values" must be an array')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a simple boolean flag definition
 *
 * @example
 * ```ts
 * const flag = createBooleanFlag('dark-mode', false, {
 *   description: 'Enable dark mode',
 *   tags: ['ui', 'theme'],
 * })
 * ```
 */
export function createBooleanFlag(
  key: string,
  defaultValue: boolean,
  options?: {
    description?: string
    tags?: string[]
    temporary?: boolean
  }
): FlagDefinition<boolean> {
  return {
    key,
    defaultValue,
    variations: [
      { value: false, label: 'Disabled' },
      { value: true, label: 'Enabled' },
    ],
    ...options,
  }
}

/**
 * Create a string flag definition
 *
 * @example
 * ```ts
 * const flag = createStringFlag('theme', 'light', ['light', 'dark', 'system'], {
 *   description: 'User theme preference',
 * })
 * ```
 */
export function createStringFlag(
  key: string,
  defaultValue: string,
  possibleValues: string[],
  options?: {
    description?: string
    tags?: string[]
    temporary?: boolean
  }
): FlagDefinition<string> {
  return {
    key,
    defaultValue,
    variations: possibleValues.map(value => ({ value })),
    ...options,
  }
}

/**
 * Create a targeting clause for email domain matching
 *
 * @example
 * ```ts
 * const clause = emailDomainClause(['@company.com', '@partner.com'])
 * ```
 */
export function emailDomainClause(domains: string[]): TargetingClause {
  return {
    attribute: 'email',
    operator: 'endsWith',
    values: domains,
  }
}

/**
 * Create a targeting clause for user ID membership
 *
 * @example
 * ```ts
 * const clause = userIdClause(['user-1', 'user-2', 'user-3'])
 * ```
 */
export function userIdClause(userIds: string[]): TargetingClause {
  return {
    attribute: 'targetingKey',
    operator: 'in',
    values: userIds,
  }
}

/**
 * Create a percentage rollout configuration
 *
 * @example 10% rollout
 * ```ts
 * const rollout = percentageRollout(10)
 * ```
 *
 * @example Custom bucketing
 * ```ts
 * const rollout = percentageRollout(50, { bucketBy: 'organizationId' })
 * ```
 */
export function percentageRollout(
  percentage: number,
  options?: { bucketBy?: string; seed?: number }
): Rollout<boolean> {
  const clampedPercentage = Math.max(0, Math.min(100, percentage))
  return {
    variations: [
      { value: false, weight: 100 - clampedPercentage },
      { value: true, weight: clampedPercentage },
    ],
    ...options,
  }
}

/**
 * Get total weight from rollout variations
 *
 * @example
 * ```ts
 * const total = getTotalWeight(rollout.variations)
 * console.log(`Total weight: ${total}%`)
 * ```
 */
export function getTotalWeight(variations: FlagVariation<unknown>[]): number {
  return variations.reduce((sum, v) => sum + (v.weight ?? 0), 0)
}

/**
 * Check if rollout weights sum to 100
 */
export function isValidRolloutWeights(variations: FlagVariation<unknown>[]): boolean {
  return getTotalWeight(variations) === 100
}

// ============================================================================
// FLAG BUILDER
// ============================================================================

/**
 * Fluent builder for creating flag definitions
 *
 * @example Boolean flag with targeting
 * ```ts
 * const flag = FlagBuilder.boolean('new-feature')
 *   .description('A new experimental feature')
 *   .tags(['beta', 'experimental'])
 *   .temporary()
 *   .targeting({
 *     id: 'internal-users',
 *     clauses: [emailDomainClause(['@company.com'])],
 *     variation: true,
 *   })
 *   .build()
 * ```
 *
 * @example String flag with variations
 * ```ts
 * const flag = FlagBuilder.string('theme', 'light')
 *   .description('User theme preference')
 *   .variation('light', 'Light Theme')
 *   .variation('dark', 'Dark Theme')
 *   .variation('system', 'System Default')
 *   .build()
 * ```
 */
export class FlagBuilder<T> {
  private flag: FlagDefinition<T>

  private constructor(key: string, defaultValue: T) {
    this.flag = {
      key,
      defaultValue,
    }
  }

  /**
   * Create a boolean flag builder
   */
  static boolean(key: string, defaultValue = false): FlagBuilder<boolean> {
    const builder = new FlagBuilder(key, defaultValue)
    builder.flag.variations = [
      { value: false, label: 'Disabled' },
      { value: true, label: 'Enabled' },
    ]
    return builder
  }

  /**
   * Create a string flag builder
   */
  static string(key: string, defaultValue: string): FlagBuilder<string> {
    return new FlagBuilder(key, defaultValue)
  }

  /**
   * Create a number flag builder
   */
  static number(key: string, defaultValue: number): FlagBuilder<number> {
    return new FlagBuilder(key, defaultValue)
  }

  /**
   * Create a generic flag builder
   */
  static create<T>(key: string, defaultValue: T): FlagBuilder<T> {
    return new FlagBuilder(key, defaultValue)
  }

  /**
   * Set the flag description
   */
  description(description: string): this {
    this.flag.description = description
    return this
  }

  /**
   * Add a variation
   */
  variation(value: T, label?: string, weight?: number): this {
    if (!this.flag.variations) {
      this.flag.variations = []
    }
    this.flag.variations.push({ value, label, weight })
    return this
  }

  /**
   * Set all variations at once
   */
  variations(variations: FlagVariation<T>[]): this {
    this.flag.variations = variations
    return this
  }

  /**
   * Add a targeting rule
   */
  targeting(rule: TargetingRule<T>): this {
    if (!this.flag.targeting) {
      this.flag.targeting = []
    }
    this.flag.targeting.push(rule)
    return this
  }

  /**
   * Add a prerequisite flag
   */
  prerequisite(key: string, variation: unknown): this {
    if (!this.flag.prerequisites) {
      this.flag.prerequisites = []
    }
    this.flag.prerequisites.push({ key, variation })
    return this
  }

  /**
   * Add tags to the flag
   */
  tags(...tags: string[]): this {
    if (!this.flag.tags) {
      this.flag.tags = []
    }
    this.flag.tags.push(...tags)
    return this
  }

  /**
   * Mark the flag as temporary
   */
  temporary(isTemporary = true): this {
    this.flag.temporary = isTemporary
    return this
  }

  /**
   * Build the flag definition
   */
  build(): FlagDefinition<T> {
    return { ...this.flag }
  }
}

// ============================================================================
// TARGETING RULE BUILDER
// ============================================================================

/**
 * Fluent builder for creating targeting rules
 *
 * @example
 * ```ts
 * const rule = TargetingRuleBuilder.create<boolean>('beta-users')
 *   .description('Enable for beta testers')
 *   .clause(emailDomainClause(['@company.com']))
 *   .clause({ attribute: 'plan', operator: 'in', values: ['enterprise'] })
 *   .variation(true)
 *   .build()
 * ```
 */
export class TargetingRuleBuilder<T> {
  private rule: TargetingRule<T>

  private constructor(id: string) {
    this.rule = {
      id,
      clauses: [],
    }
  }

  /**
   * Create a new targeting rule builder
   */
  static create<T>(id: string): TargetingRuleBuilder<T> {
    return new TargetingRuleBuilder<T>(id)
  }

  /**
   * Set the rule description
   */
  description(description: string): this {
    this.rule.description = description
    return this
  }

  /**
   * Add a targeting clause
   */
  clause(clause: TargetingClause): this {
    this.rule.clauses.push(clause)
    return this
  }

  /**
   * Set the variation value (mutually exclusive with rollout)
   */
  variation(value: T): this {
    this.rule.variation = value
    delete this.rule.rollout
    return this
  }

  /**
   * Set a rollout (mutually exclusive with variation)
   */
  rollout(rollout: Rollout<T>): this {
    this.rule.rollout = rollout
    delete this.rule.variation
    return this
  }

  /**
   * Build the targeting rule
   */
  build(): TargetingRule<T> {
    return { ...this.rule }
  }
}
