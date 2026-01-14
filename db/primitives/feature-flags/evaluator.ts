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
 */

import { murmurHash3 } from '../utils/murmur3'

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

// Valid flag types for validation
const VALID_FLAG_TYPES: FlagType[] = ['boolean', 'string', 'number', 'json']

/**
 * FlagEvaluator provides feature flag evaluation
 */
export class FlagEvaluator {
  private flags: Map<string, FlagDefinition>
  private store?: FlagStore
  private environment?: string
  private killSwitch: boolean
  private pendingLogs: EvaluationLog[] = []
  private readonly bucketCount = 10000 // For 0.01% precision

  constructor(config?: FlagEvaluatorConfig) {
    this.flags = new Map()
    this.store = config?.store
    this.environment = config?.environment
    this.killSwitch = config?.killSwitch ?? false

    // Validate and store flags
    if (config?.flags) {
      for (const flag of config.flags) {
        this.validateFlag(flag)
        this.flags.set(flag.key, flag)
      }
    }
  }

  /**
   * Validate a flag definition
   */
  private validateFlag(flag: FlagDefinition): void {
    // Validate flag type
    if (!VALID_FLAG_TYPES.includes(flag.type)) {
      throw new Error(`Invalid flag type: ${flag.type}`)
    }

    // Validate variant types match flag type
    if (flag.variants) {
      for (const variant of flag.variants) {
        const variantType = this.getValueType(variant.value)
        if (variantType !== flag.type) {
          throw new Error(`Variant type mismatch: variant "${variant.key}" has type ${variantType} but flag "${flag.key}" is type ${flag.type}`)
        }
      }
    }
  }

  /**
   * Get the type of a value
   */
  private getValueType(value: unknown): FlagType {
    if (typeof value === 'boolean') return 'boolean'
    if (typeof value === 'string') return 'string'
    if (typeof value === 'number') return 'number'
    if (typeof value === 'object' && value !== null) return 'json'
    return 'json' // Default to json for unknown types
  }

  /**
   * Get bucket value for a user/flag combination (0-100)
   */
  private getBucket(flagKey: string, userId: string, stickiness?: Stickiness, sessionId?: string): number {
    let key: string
    if (stickiness === 'sessionId' && sessionId) {
      key = sessionId
    } else if (stickiness === 'random') {
      key = `${userId}-${Date.now()}-${Math.random()}`
    } else {
      key = userId // Default to userId
    }

    const hashInput = `${flagKey}.${key}`
    const hash = murmurHash3(hashInput, 0)
    const bucket = hash % this.bucketCount
    return (bucket / this.bucketCount) * 100
  }

  /**
   * Select a variant based on bucket value and weights
   */
  private selectVariant<T>(variants: FlagVariant<T>[], bucket: number): { value: T; variant: string } | null {
    if (!variants || variants.length === 0) return null

    // Normalize bucket to percentage (0-100)
    let cumulative = 0
    for (const variant of variants) {
      cumulative += variant.weight
      if (bucket < cumulative) {
        return { value: variant.value, variant: variant.key }
      }
    }

    // Fallback to last variant
    const lastVariant = variants[variants.length - 1]!
    return { value: lastVariant.value, variant: lastVariant.key }
  }

  /**
   * Evaluate targeting rules against context
   */
  private evaluateRules(rules: TargetingRule[], context: EvaluationContext): { matched: boolean; value: unknown } {
    for (const rule of rules) {
      if (this.evaluateRule(rule, context)) {
        return { matched: true, value: rule.value }
      }
    }
    return { matched: false, value: undefined }
  }

  /**
   * Evaluate a single rule (all conditions must match - AND logic)
   */
  private evaluateRule(rule: TargetingRule, context: EvaluationContext): boolean {
    for (const condition of rule.conditions) {
      if (!this.evaluateCondition(condition, context)) {
        return false
      }
    }
    return true
  }

  /**
   * Evaluate a single condition
   */
  private evaluateCondition(condition: RuleCondition, context: EvaluationContext): boolean {
    // Handle segment membership
    if (condition.segment) {
      return context.segments.includes(condition.segment)
    }

    // Handle attribute conditions
    if (!condition.attribute || !condition.operator) {
      return false
    }

    const attrValue = context.attributes[condition.attribute]
    const targetValue = condition.value

    switch (condition.operator) {
      case 'equals':
        return attrValue === targetValue

      case 'notEquals':
        return attrValue !== targetValue

      case 'contains':
        return typeof attrValue === 'string' && typeof targetValue === 'string' && attrValue.includes(targetValue)

      case 'notContains':
        return typeof attrValue === 'string' && typeof targetValue === 'string' && !attrValue.includes(targetValue)

      case 'in':
        return Array.isArray(targetValue) && targetValue.includes(attrValue)

      case 'notIn':
        return Array.isArray(targetValue) && !targetValue.includes(attrValue)

      case 'greaterThan':
        return typeof attrValue === 'number' && typeof targetValue === 'number' && attrValue > targetValue

      case 'lessThan':
        return typeof attrValue === 'number' && typeof targetValue === 'number' && attrValue < targetValue

      case 'greaterThanOrEquals':
        return typeof attrValue === 'number' && typeof targetValue === 'number' && attrValue >= targetValue

      case 'lessThanOrEquals':
        return typeof attrValue === 'number' && typeof targetValue === 'number' && attrValue <= targetValue

      default:
        return false
    }
  }

  /**
   * Check prerequisites for a flag (detect circular dependencies)
   */
  private async checkPrerequisites(
    flag: FlagDefinition,
    context: EvaluationContext,
    visitedFlags: Set<string>
  ): Promise<{ met: boolean; reason: EvaluationReason }> {
    if (!flag.prerequisites || flag.prerequisites.length === 0) {
      return { met: true, reason: 'MATCH' }
    }

    for (const prereq of flag.prerequisites) {
      // Check for circular dependency
      if (visitedFlags.has(prereq.flagKey)) {
        throw new Error(`Circular dependency detected: ${flag.key} -> ${prereq.flagKey}`)
      }

      // Evaluate prerequisite flag
      const prereqFlag = this.flags.get(prereq.flagKey)
      if (!prereqFlag) {
        return { met: false, reason: 'PREREQUISITE_NOT_MET' }
      }

      // Add to visited set before evaluating
      const newVisited = new Set(visitedFlags)
      newVisited.add(prereq.flagKey)

      const prereqResult = await this.evaluateInternal(prereq.flagKey, context, {}, newVisited)

      if (prereqResult.value !== prereq.value) {
        return { met: false, reason: 'PREREQUISITE_NOT_MET' }
      }
    }

    return { met: true, reason: 'MATCH' }
  }

  /**
   * Check if a flag is expired
   */
  private isExpired(flag: FlagDefinition): boolean {
    if (!flag.expiresAt) return false
    return new Date(flag.expiresAt).getTime() < Date.now()
  }

  /**
   * Internal evaluation method with circular dependency tracking
   */
  private async evaluateInternal<T = unknown>(
    flagKey: string,
    context: EvaluationContext,
    options: EvaluationOptions,
    visitedFlags: Set<string>
  ): Promise<EvaluationResult<T>> {
    const startTime = performance.now()
    const flag = this.flags.get(flagKey)

    // Flag not found
    if (!flag) {
      const defaultValue = (options.defaultValue ?? null) as T
      return this.createResult(flagKey, defaultValue, 'FLAG_NOT_FOUND', undefined, undefined, context, startTime)
    }

    // Kill switch - return default value
    if (this.killSwitch) {
      const defaultValue = (options.defaultValue ?? flag.defaultValue) as T
      return this.createResult(flagKey, defaultValue, 'KILL_SWITCH', undefined, undefined, context, startTime)
    }

    // Flag disabled
    if (!flag.enabled) {
      const defaultValue = (options.defaultValue ?? flag.defaultValue) as T
      return this.createResult(flagKey, defaultValue, 'FLAG_DISABLED', undefined, undefined, context, startTime)
    }

    // Check expiry
    if (this.isExpired(flag)) {
      // Notify about stale flag
      if (this.store?.onStaleFlagEvaluated) {
        this.store.onStaleFlagEvaluated(flag)
      }
      const defaultValue = (options.defaultValue ?? flag.defaultValue) as T
      return this.createResult(flagKey, defaultValue, 'FLAG_EXPIRED', undefined, undefined, context, startTime)
    }

    // Check environment
    if (flag.environments && flag.environments.length > 0) {
      if (!this.environment || !flag.environments.includes(this.environment)) {
        const defaultValue = (options.defaultValue ?? flag.defaultValue) as T
        return this.createResult(flagKey, defaultValue, 'ENVIRONMENT_MISMATCH', undefined, undefined, context, startTime)
      }
    }

    // Check environment-specific values
    if (flag.environmentValues && this.environment && flag.environmentValues[this.environment] !== undefined) {
      const value = flag.environmentValues[this.environment] as T
      return this.createResult(flagKey, value, 'MATCH', undefined, undefined, context, startTime)
    }

    // Check prerequisites
    const prereqResult = await this.checkPrerequisites(flag, context, visitedFlags)
    if (!prereqResult.met) {
      const defaultValue = (options.defaultValue ?? flag.defaultValue) as T
      return this.createResult(flagKey, defaultValue, prereqResult.reason, undefined, undefined, context, startTime)
    }

    // Get bucket for percentage/variant selection
    const bucket = this.getBucket(flagKey, context.userId, flag.stickiness, context.sessionId)

    // Check rollout percentage
    if (flag.rolloutPercentage !== undefined && flag.rolloutPercentage < 100) {
      if (bucket >= flag.rolloutPercentage) {
        const defaultValue = (options.defaultValue ?? flag.defaultValue) as T
        return this.createResult(flagKey, defaultValue, 'NOT_IN_ROLLOUT', undefined, bucket, context, startTime)
      }
    }

    // Evaluate targeting rules
    if (flag.rules && flag.rules.length > 0) {
      const ruleResult = this.evaluateRules(flag.rules, context)
      if (ruleResult.matched) {
        return this.createResult(flagKey, ruleResult.value as T, 'MATCH', undefined, bucket, context, startTime)
      }
      // If rules exist but none matched, return default value
      return this.createResult(flagKey, flag.defaultValue as T, 'DEFAULT', undefined, bucket, context, startTime)
    }

    // Select variant if available
    if (flag.variants && flag.variants.length > 0) {
      const variantResult = this.selectVariant(flag.variants as FlagVariant<T>[], bucket)
      if (variantResult) {
        return this.createResult(flagKey, variantResult.value, 'MATCH', variantResult.variant, bucket, context, startTime)
      }
    }

    // For boolean flags with enabled=true and no variants/rules, return true
    if (flag.type === 'boolean' && flag.enabled) {
      return this.createResult(flagKey, true as unknown as T, 'MATCH', undefined, bucket, context, startTime)
    }

    // Return default value
    return this.createResult(flagKey, flag.defaultValue as T, 'DEFAULT', undefined, bucket, context, startTime)
  }

  /**
   * Create an evaluation result and log it
   */
  private createResult<T>(
    flagKey: string,
    value: T,
    reason: EvaluationReason,
    variant: string | undefined,
    bucket: number | undefined,
    context: EvaluationContext,
    startTime: number
  ): EvaluationResult<T> {
    const evaluationLatencyMs = performance.now() - startTime
    const flag = this.flags.get(flagKey)

    // Log the evaluation if logging is enabled (either log or logBatch must be available)
    if ((this.store?.log || this.store?.logBatch) && flag && !flag.disableLogging) {
      const logEntry: EvaluationLog = {
        flagKey,
        userId: context.userId,
        value,
        variant,
        reason,
        timestamp: Date.now(),
        evaluationLatencyMs,
      }

      // Use batch logging if available, otherwise immediate logging
      if (this.store.logBatch) {
        this.pendingLogs.push(logEntry)
      } else if (this.store.log) {
        this.store.log(logEntry)
      }
    }

    return {
      flagKey,
      value,
      variant,
      reason,
      bucket,
    }
  }

  /**
   * Evaluate a flag and return the result
   */
  async evaluate<T = unknown>(
    flagKey: string,
    context: EvaluationContext,
    options: EvaluationOptions = {}
  ): Promise<EvaluationResult<T>> {
    return this.evaluateInternal<T>(flagKey, context, options, new Set([flagKey]))
  }

  /**
   * Get a boolean flag value
   */
  async getBooleanValue(
    flagKey: string,
    context: EvaluationContext,
    defaultValue: boolean
  ): Promise<boolean> {
    const flag = this.flags.get(flagKey)
    if (flag && flag.type !== 'boolean') {
      throw new Error(`Type mismatch: flag "${flagKey}" is type ${flag.type}, expected boolean`)
    }

    const result = await this.evaluate<boolean>(flagKey, context, { defaultValue })
    return result.value
  }

  /**
   * Get a string flag value
   */
  async getStringValue(
    flagKey: string,
    context: EvaluationContext,
    defaultValue: string
  ): Promise<string> {
    const flag = this.flags.get(flagKey)
    if (flag && flag.type !== 'string') {
      throw new Error(`Type mismatch: flag "${flagKey}" is type ${flag.type}, expected string`)
    }

    const result = await this.evaluate<string>(flagKey, context, { defaultValue })
    return result.value
  }

  /**
   * Get a number flag value
   */
  async getNumberValue(
    flagKey: string,
    context: EvaluationContext,
    defaultValue: number
  ): Promise<number> {
    const flag = this.flags.get(flagKey)
    if (flag && flag.type !== 'number') {
      throw new Error(`Type mismatch: flag "${flagKey}" is type ${flag.type}, expected number`)
    }

    const result = await this.evaluate<number>(flagKey, context, { defaultValue })
    return result.value
  }

  /**
   * Get a JSON flag value
   */
  async getJsonValue<T = unknown>(
    flagKey: string,
    context: EvaluationContext,
    defaultValue: T
  ): Promise<T> {
    const flag = this.flags.get(flagKey)
    if (flag && flag.type !== 'json') {
      throw new Error(`Type mismatch: flag "${flagKey}" is type ${flag.type}, expected json`)
    }

    const result = await this.evaluate<T>(flagKey, context, { defaultValue })
    return result.value
  }

  /**
   * Update a flag at runtime
   */
  async setFlag(flagKey: string, updates: Partial<FlagDefinition>): Promise<void> {
    const existingFlag = this.flags.get(flagKey)
    if (existingFlag) {
      const updatedFlag = { ...existingFlag, ...updates }
      this.validateFlag(updatedFlag as FlagDefinition)
      this.flags.set(flagKey, updatedFlag as FlagDefinition)
    }
  }

  /**
   * Enable or disable the kill switch
   */
  setKillSwitch(enabled: boolean): void {
    this.killSwitch = enabled
  }

  /**
   * Set the current environment
   */
  setEnvironment(environment: string): void {
    this.environment = environment
  }

  /**
   * Get all stale (expired) flags
   */
  getStaleFlags(): FlagDefinition[] {
    const now = Date.now()
    const stale: FlagDefinition[] = []

    for (const flag of this.flags.values()) {
      if (flag.expiresAt && new Date(flag.expiresAt).getTime() < now) {
        stale.push(flag)
      }
    }

    return stale
  }

  /**
   * Get flags expiring within the given time window
   */
  getFlagsExpiringSoon(withinMs: number): FlagDefinition[] {
    const now = Date.now()
    const cutoff = now + withinMs
    const expiring: FlagDefinition[] = []

    for (const flag of this.flags.values()) {
      if (flag.expiresAt) {
        const expiryTime = new Date(flag.expiresAt).getTime()
        // Include flags that are not yet expired but will expire within the window
        if (expiryTime > now && expiryTime <= cutoff) {
          expiring.push(flag)
        }
      }
    }

    return expiring
  }

  /**
   * Get time until a flag expires (negative if already expired)
   */
  getTimeUntilExpiry(flagKey: string): number {
    const flag = this.flags.get(flagKey)
    if (!flag || !flag.expiresAt) {
      return Infinity
    }

    return new Date(flag.expiresAt).getTime() - Date.now()
  }

  /**
   * Flush pending evaluation logs
   */
  async flush(): Promise<void> {
    if (this.store?.logBatch && this.pendingLogs.length > 0) {
      await this.store.logBatch([...this.pendingLogs])
      this.pendingLogs = []
    }
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
