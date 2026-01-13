/**
 * @module feature-flags
 *
 * Feature Flags Primitive - Comprehensive feature flag management for the dotdo platform.
 *
 * Provides runtime feature control with percentage rollouts, attribute-based targeting,
 * A/B testing variants, scheduled releases, and user overrides. Designed for zero-latency
 * edge evaluation with deterministic hashing for consistent user experiences.
 *
 * ## Capabilities
 *
 * - **Boolean flags** with default values and enable/disable control
 * - **Percentage rollouts** with deterministic user bucketing
 * - **Attribute targeting** with rich comparison operators
 * - **Multi-variant experiments** for A/B testing
 * - **Scheduled releases** with start/end times
 * - **User/session overrides** for testing and VIP access
 * - **Cohort targeting** for predefined user segments
 *
 * @example Basic Feature Flags
 * ```typescript
 * import { FeatureFlagClient } from 'dotdo/primitives/feature-flags'
 *
 * const client = new FeatureFlagClient({
 *   flags: [
 *     { key: 'dark-mode', enabled: true, defaultValue: false },
 *     {
 *       key: 'new-dashboard',
 *       enabled: true,
 *       defaultValue: false,
 *       rollout: { percentage: 20 }
 *     }
 *   ]
 * })
 *
 * if (client.isEnabled('dark-mode', { userId: 'user-123' })) {
 *   // Show dark mode UI
 * }
 * ```
 *
 * @example Percentage Rollout
 * ```typescript
 * const client = new FeatureFlagClient({
 *   flags: [{
 *     key: 'ai-assistant',
 *     enabled: true,
 *     defaultValue: false,
 *     rollout: {
 *       percentage: 10, // 10% of users
 *       bucketBy: 'userId', // Deterministic by user
 *     },
 *   }],
 * })
 *
 * // Same user always gets same result
 * const enabled = client.isEnabled('ai-assistant', { userId: 'user-456' })
 * ```
 *
 * @example Attribute-Based Targeting
 * ```typescript
 * const client = new FeatureFlagClient({
 *   flags: [{
 *     key: 'premium-features',
 *     enabled: true,
 *     defaultValue: false,
 *     rules: [{
 *       id: 'enterprise-only',
 *       conditions: [
 *         { attribute: 'plan', operator: 'in', values: ['enterprise', 'business'] },
 *         { attribute: 'seats', operator: 'gte', values: [10] },
 *       ],
 *       value: true,
 *     }],
 *   }],
 * })
 *
 * const result = client.evaluate('premium-features', {
 *   attributes: { plan: 'enterprise', seats: 50 },
 * })
 * ```
 *
 * @example A/B Testing with Variants
 * ```typescript
 * const client = new FeatureFlagClient({
 *   flags: [{
 *     key: 'checkout-flow',
 *     enabled: true,
 *     defaultValue: 'control',
 *     variants: [
 *       { key: 'control', value: 'classic', weight: 50 },
 *       { key: 'treatment', value: 'streamlined', weight: 50 },
 *     ],
 *   }],
 * })
 *
 * const variant = client.getVariant('checkout-flow', { userId: 'user-789' })
 * // Returns 'classic' or 'streamlined' based on deterministic bucketing
 * ```
 *
 * @example Scheduled Release
 * ```typescript
 * const client = new FeatureFlagClient({
 *   flags: [{
 *     key: 'holiday-theme',
 *     enabled: true,
 *     defaultValue: false,
 *     rollout: {
 *       schedule: {
 *         start: '2024-12-20T00:00:00Z',
 *         end: '2024-12-26T23:59:59Z',
 *       },
 *     },
 *   }],
 * })
 * ```
 *
 * @packageDocumentation
 */

import type {
  FeatureFlag,
  EvaluationContext,
  EvaluationResult,
  FlagValue,
  FlagOverride,
  FlagRule,
  TargetingRule,
  Cohort,
  Schedule,
  RolloutConfig,
  FeatureFlagConfig,
  Variant,
} from './types'

import { murmurHash3 } from '../../db/primitives/utils/murmur3'

// Re-export types
export type {
  FeatureFlag,
  EvaluationContext,
  EvaluationResult,
  FlagValue,
  FlagOverride,
  FlagRule,
  TargetingRule,
  Cohort,
  Schedule,
  RolloutConfig,
  FeatureFlagConfig,
  Variant,
}

/**
 * Storage for feature flags
 */
export class FlagStore {
  private flags: Map<string, FeatureFlag> = new Map()

  constructor(flags?: FeatureFlag[]) {
    if (flags) {
      for (const flag of flags) {
        this.flags.set(flag.key, flag)
      }
    }
  }

  get(key: string): FeatureFlag | undefined {
    return this.flags.get(key)
  }

  set(flag: FeatureFlag): void {
    this.flags.set(flag.key, flag)
  }

  delete(key: string): boolean {
    return this.flags.delete(key)
  }

  getAll(): FeatureFlag[] {
    return Array.from(this.flags.values())
  }

  has(key: string): boolean {
    return this.flags.has(key)
  }

  clear(): void {
    this.flags.clear()
  }

  setAll(flags: FeatureFlag[]): void {
    this.flags.clear()
    for (const flag of flags) {
      this.flags.set(flag.key, flag)
    }
  }
}

/**
 * Rule engine for evaluating targeting conditions
 */
export class RuleEngine {
  /**
   * Get a value from an object using dot notation path
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.')
    let current: unknown = obj

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined
      }
      if (typeof current !== 'object') {
        return undefined
      }
      current = (current as Record<string, unknown>)[part]
    }

    return current
  }

  /**
   * Evaluate a single targeting condition against context
   */
  evaluateCondition(
    condition: TargetingRule,
    context: Record<string, unknown>
  ): boolean {
    const value = this.getNestedValue(context, condition.attribute)
    const targetValue = condition.values[0]

    switch (condition.operator) {
      case 'eq':
        return value === targetValue

      case 'neq':
        return value !== targetValue

      case 'gt':
        return typeof value === 'number' && typeof targetValue === 'number' && value > targetValue

      case 'gte':
        return typeof value === 'number' && typeof targetValue === 'number' && value >= targetValue

      case 'lt':
        return typeof value === 'number' && typeof targetValue === 'number' && value < targetValue

      case 'lte':
        return typeof value === 'number' && typeof targetValue === 'number' && value <= targetValue

      case 'in':
        return condition.values.includes(value)

      case 'nin':
        return !condition.values.includes(value)

      case 'contains':
        return typeof value === 'string' && typeof targetValue === 'string' && value.includes(targetValue)

      case 'startsWith':
        return typeof value === 'string' && typeof targetValue === 'string' && value.startsWith(targetValue)

      case 'endsWith':
        return typeof value === 'string' && typeof targetValue === 'string' && value.endsWith(targetValue)

      case 'matches':
        if (typeof value !== 'string' || typeof targetValue !== 'string') {
          return false
        }
        try {
          const regex = new RegExp(targetValue)
          return regex.test(value)
        } catch {
          return false
        }

      default:
        return false
    }
  }

  /**
   * Evaluate all conditions in a rule (AND logic)
   */
  evaluateConditions(
    conditions: TargetingRule[],
    context: Record<string, unknown>
  ): boolean {
    return conditions.every((condition) => this.evaluateCondition(condition, context))
  }

  /**
   * Evaluate condition groups with OR logic between groups
   */
  evaluateConditionGroups(
    groups: TargetingRule[][],
    context: Record<string, unknown>
  ): boolean {
    return groups.some((group) => this.evaluateConditions(group, context))
  }

  /**
   * Evaluate a complete rule against context
   */
  evaluateRule(rule: FlagRule, context: Record<string, unknown>): boolean {
    // Check if rule is disabled
    if (rule.enabled === false) {
      return false
    }

    // If conditionGroups provided, use OR logic between groups
    if (rule.conditionGroups && rule.conditionGroups.length > 0) {
      return this.evaluateConditionGroups(rule.conditionGroups, context)
    }

    // Otherwise use AND logic for conditions
    if (rule.conditions && rule.conditions.length > 0) {
      return this.evaluateConditions(rule.conditions, context)
    }

    // No conditions means rule matches everything
    return true
  }
}

/**
 * Deterministic percentage rollout using MurmurHash3 for consistent hashing
 */
export class PercentageRollout {
  /**
   * Generate a deterministic hash value between 0 and 100
   * Uses MurmurHash3 for excellent distribution properties.
   *
   * @param key - User/bucket key
   * @param flagKey - Feature flag key
   * @param salt - Optional salt for rebucketing (changing salt rebuckets all users)
   */
  hash(key: string, flagKey: string, salt?: string): number {
    // Build hash input: flagKey.salt.key or flagKey.flagKey.key (salt defaults to flagKey)
    // This ensures different salts produce different hash distributions
    const effectiveSalt = salt ?? flagKey
    const hashInput = `${flagKey}.${effectiveSalt}.${key}`

    // Use MurmurHash3 with seed 0 for deterministic results
    const hashValue = murmurHash3(hashInput, 0)

    // Normalize to 0-100 using modulo 10000 for 0.01% precision, then scale
    const bucket = hashValue % 10000
    return (bucket / 10000) * 100
  }

  /**
   * Check if a user is included in the rollout percentage
   * @param bucketKey - User/bucket key
   * @param flagKey - Feature flag key
   * @param percentage - Rollout percentage (0-100)
   * @param salt - Optional salt for rebucketing
   */
  isIncluded(bucketKey: string, flagKey: string, percentage: number, salt?: string): boolean {
    if (percentage >= 100) return true
    if (percentage <= 0) return false

    const hashValue = this.hash(bucketKey, flagKey, salt)
    return hashValue < percentage
  }
}

/**
 * Cohort targeting for user segment membership
 */
export class CohortTargeting {
  private cohorts: Map<string, Cohort> = new Map()
  private ruleEngine: RuleEngine

  constructor(cohorts?: Cohort[]) {
    this.ruleEngine = new RuleEngine()
    if (cohorts) {
      for (const cohort of cohorts) {
        this.cohorts.set(cohort.id, cohort)
      }
    }
  }

  /**
   * Check if user is in a specific cohort
   */
  isInCohort(cohortId: string, context: EvaluationContext): boolean {
    const cohort = this.cohorts.get(cohortId)
    if (!cohort) {
      return false
    }

    // Check explicit userIds first
    if (cohort.userIds && cohort.userIds.length > 0) {
      if (context.userId && cohort.userIds.includes(context.userId)) {
        return true
      }
    }

    // Check rules
    if (cohort.rules && cohort.rules.length > 0) {
      const flatContext = this.flattenContext(context)
      return this.ruleEngine.evaluateConditions(cohort.rules, flatContext)
    }

    return false
  }

  private flattenContext(context: EvaluationContext): Record<string, unknown> {
    return {
      userId: context.userId,
      sessionId: context.sessionId,
      ...(context.attributes || {}),
    }
  }
}

/**
 * Time-based flag scheduling
 */
export class ScheduledFlags {
  /**
   * Check if a schedule is currently active
   */
  isActive(schedule: Schedule, timestamp?: string): boolean {
    const checkTime = timestamp ? new Date(timestamp) : new Date()

    if (schedule.start) {
      const startTime = new Date(schedule.start)
      if (checkTime < startTime) {
        return false
      }
    }

    if (schedule.end) {
      const endTime = new Date(schedule.end)
      if (checkTime > endTime) {
        return false
      }
    }

    return true
  }
}

/**
 * Per-user/session flag overrides
 */
export class FlagOverrides {
  private overrides: FlagOverride[] = []

  constructor(overrides?: FlagOverride[]) {
    if (overrides) {
      this.overrides = [...overrides]
    }
  }

  /**
   * Get override for a specific flag and context
   * User overrides take precedence over session overrides
   */
  getOverride(flagKey: string, context: EvaluationContext): FlagOverride | undefined {
    const now = new Date()

    // First try to find user-specific override
    if (context.userId) {
      const userOverride = this.overrides.find(
        (o) =>
          o.flagKey === flagKey &&
          o.userId === context.userId &&
          (!o.expiresAt || new Date(o.expiresAt) > now)
      )
      if (userOverride) {
        return userOverride
      }
    }

    // Then try session-specific override
    if (context.sessionId) {
      const sessionOverride = this.overrides.find(
        (o) =>
          o.flagKey === flagKey &&
          o.sessionId === context.sessionId &&
          !o.userId && // Only pure session overrides, not user overrides
          (!o.expiresAt || new Date(o.expiresAt) > now)
      )
      if (sessionOverride) {
        return sessionOverride
      }
    }

    return undefined
  }

  /**
   * Add a new override
   */
  add(override: FlagOverride): void {
    this.overrides.push(override)
  }

  /**
   * Remove an override for a user
   */
  remove(flagKey: string, userId: string): void {
    this.overrides = this.overrides.filter(
      (o) => !(o.flagKey === flagKey && o.userId === userId)
    )
  }

  /**
   * Remove session override
   */
  removeSession(flagKey: string, sessionId: string): void {
    this.overrides = this.overrides.filter(
      (o) => !(o.flagKey === flagKey && o.sessionId === sessionId)
    )
  }
}

/**
 * Main feature flag client
 */
export class FeatureFlagClient {
  private store: FlagStore
  private ruleEngine: RuleEngine
  private rollout: PercentageRollout
  private cohortTargeting: CohortTargeting
  private scheduler: ScheduledFlags
  private overrides: FlagOverrides
  private defaultContext: EvaluationContext

  constructor(config: FeatureFlagConfig = {}) {
    this.store = new FlagStore(config.flags)
    this.ruleEngine = new RuleEngine()
    this.rollout = new PercentageRollout()
    this.cohortTargeting = new CohortTargeting(config.cohorts)
    this.scheduler = new ScheduledFlags()
    this.overrides = new FlagOverrides(config.overrides)
    this.defaultContext = config.defaultContext || {}
  }

  /**
   * Merge context with default context
   */
  private mergeContext(context?: EvaluationContext): EvaluationContext {
    return {
      ...this.defaultContext,
      ...context,
      attributes: {
        ...(this.defaultContext.attributes || {}),
        ...(context?.attributes || {}),
      },
    }
  }

  /**
   * Flatten context for rule evaluation
   */
  private flattenContext(context: EvaluationContext): Record<string, unknown> {
    return {
      userId: context.userId,
      sessionId: context.sessionId,
      ...(context.attributes || {}),
    }
  }

  /**
   * Get the bucket key for rollout calculations
   */
  private getBucketKey(
    context: EvaluationContext,
    rollout?: RolloutConfig
  ): string {
    if (rollout?.bucketBy) {
      const flatContext = this.flattenContext(context)
      const value = flatContext[rollout.bucketBy] as string | undefined
      return value || context.userId || context.sessionId || 'anonymous'
    }
    return context.userId || context.sessionId || 'anonymous'
  }

  /**
   * Select a variant based on weights
   */
  private selectVariant(
    variants: Variant[],
    bucketKey: string,
    flagKey: string
  ): Variant | undefined {
    if (!variants || variants.length === 0) {
      return undefined
    }

    // Calculate total weight
    const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0)
    if (totalWeight === 0) {
      return variants[0]
    }

    // Get hash value (0-100) and scale to total weight
    const hashValue = this.rollout.hash(bucketKey, `${flagKey}:variant`)
    const scaledValue = (hashValue / 100) * totalWeight

    // Find variant based on cumulative weights
    let cumulative = 0
    for (const variant of variants) {
      cumulative += variant.weight
      if (scaledValue < cumulative) {
        return variant
      }
    }

    // Fallback to last variant
    return variants[variants.length - 1]
  }

  /**
   * Evaluate a flag and return detailed result
   */
  evaluate(flagKey: string, context?: EvaluationContext): EvaluationResult {
    const mergedContext = this.mergeContext(context)
    const flag = this.store.get(flagKey)

    // Flag not found
    if (!flag) {
      return {
        value: false,
        flagFound: false,
        reason: 'FLAG_NOT_FOUND',
      }
    }

    // Flag disabled
    if (!flag.enabled) {
      return {
        value: false,
        flagFound: true,
        reason: 'FLAG_DISABLED',
      }
    }

    // Check for overrides first (highest priority)
    const override = this.overrides.getOverride(flagKey, mergedContext)
    if (override) {
      return {
        value: override.value,
        flagFound: true,
        reason: 'OVERRIDE',
      }
    }

    const flatContext = this.flattenContext(mergedContext)
    const bucketKey = this.getBucketKey(mergedContext, flag.rollout)

    // Check schedule if present
    if (flag.rollout?.schedule) {
      const isScheduleActive = this.scheduler.isActive(
        flag.rollout.schedule,
        mergedContext.timestamp
      )
      if (!isScheduleActive) {
        return {
          value: false,
          flagFound: true,
          reason: 'SCHEDULED',
        }
      }
    }

    // Check cohort targeting
    if (flag.rollout?.cohort) {
      const isInCohort = this.cohortTargeting.isInCohort(
        flag.rollout.cohort,
        mergedContext
      )
      if (!isInCohort) {
        return {
          value: flag.defaultValue,
          flagFound: true,
          reason: 'DEFAULT_VALUE',
        }
      }
    }

    // Evaluate rules in order
    if (flag.rules && flag.rules.length > 0) {
      for (const rule of flag.rules) {
        if (this.ruleEngine.evaluateRule(rule, flatContext)) {
          // Rule matched - check percentage rollout within rule
          if (rule.percentage !== undefined) {
            if (!this.rollout.isIncluded(bucketKey, flagKey, rule.percentage)) {
              continue // Not in rollout, try next rule
            }
          }

          // Check if rule specifies a variant
          if (rule.variant && flag.variants) {
            const variant = flag.variants.find((v) => v.key === rule.variant)
            if (variant) {
              return {
                value: variant.value,
                variant: variant.key,
                ruleId: rule.id,
                flagFound: true,
                reason: 'RULE_MATCH',
              }
            }
          }

          // Return rule value
          if (rule.value !== undefined) {
            return {
              value: rule.value,
              ruleId: rule.id,
              flagFound: true,
              reason: 'RULE_MATCH',
            }
          }
        }
      }
    }

    // Check variants (experiment mode)
    if (flag.variants && flag.variants.length > 0) {
      const selectedVariant = this.selectVariant(flag.variants, bucketKey, flagKey)
      if (selectedVariant) {
        return {
          value: selectedVariant.value,
          variant: selectedVariant.key,
          flagFound: true,
          reason: 'VARIANT_SELECTED',
        }
      }
    }

    // Check global rollout
    if (flag.rollout?.percentage !== undefined) {
      const isIncluded = this.rollout.isIncluded(
        bucketKey,
        flagKey,
        flag.rollout.percentage,
        flag.rollout.salt
      )
      return {
        value: isIncluded ? (flag.defaultValue || true) : (typeof flag.defaultValue === 'boolean' ? false : flag.defaultValue),
        flagFound: true,
        reason: 'PERCENTAGE_ROLLOUT',
      }
    }

    // Return default value
    return {
      value: flag.defaultValue,
      flagFound: true,
      reason: 'DEFAULT_VALUE',
    }
  }

  /**
   * Simple boolean check for a flag
   */
  isEnabled(flagKey: string, context?: EvaluationContext): boolean {
    const result = this.evaluate(flagKey, context)
    return Boolean(result.value)
  }

  /**
   * Get the variant value for a flag
   */
  getVariant(flagKey: string, context?: EvaluationContext): FlagValue {
    const result = this.evaluate(flagKey, context)
    return result.value
  }

  /**
   * Get all flag values for a context
   */
  getAllFlags(context?: EvaluationContext): Record<string, FlagValue> {
    const flags = this.store.getAll()
    const result: Record<string, FlagValue> = {}

    for (const flag of flags) {
      const evaluation = this.evaluate(flag.key, context)
      result[flag.key] = evaluation.value
    }

    return result
  }

  /**
   * Update all flags in the store
   */
  updateFlags(flags: FeatureFlag[]): void {
    this.store.setAll(flags)
  }

  /**
   * Add a single flag
   */
  addFlag(flag: FeatureFlag): void {
    this.store.set(flag)
  }

  /**
   * Remove a flag
   */
  removeFlag(key: string): boolean {
    return this.store.delete(key)
  }

  /**
   * Set an override for a user/session
   */
  setOverride(override: FlagOverride): void {
    this.overrides.add(override)
  }

  /**
   * Remove an override for a user
   */
  removeOverride(flagKey: string, userId: string): void {
    this.overrides.remove(flagKey, userId)
  }

  /**
   * Get the underlying flag store for direct access
   */
  getStore(): FlagStore {
    return this.store
  }

  /**
   * Get a specific flag definition
   */
  getFlag(key: string): FeatureFlag | undefined {
    return this.store.get(key)
  }

  /**
   * Check if a flag exists
   */
  hasFlag(key: string): boolean {
    return this.store.has(key)
  }
}

/**
 * Create a feature flag client with the given configuration
 * Convenience factory function
 */
export function createFeatureFlagClient(config: FeatureFlagConfig = {}): FeatureFlagClient {
  return new FeatureFlagClient(config)
}
