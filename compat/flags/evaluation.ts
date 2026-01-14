/**
 * @dotdo/flags - Flag Evaluation Engine
 *
 * Core evaluation logic for feature flags including:
 * - Boolean, string, number, and JSON flag types
 * - User targeting
 * - Rule-based evaluation
 * - Percentage rollouts
 * - Prerequisites
 */

import { murmurHash3_32 } from '../../db/primitives/utils/murmur3'
import {
  type LDFlagValue,
  type LDUser,
  type LDContext,
  type LDEvaluationDetail,
  type LDEvaluationReason,
  type FeatureFlag,
  type FlagRule,
  type Clause,
  type Target,
  type RolloutConfig,
  type WeightedVariation,
  type VariationOrRollout,
  type Prerequisite,
} from './types'
import { evaluateClause } from './targeting'

// =============================================================================
// Constants
// =============================================================================

const BUCKET_SCALE = 100000 // Weight scale (100000 = 100%)

// =============================================================================
// Context Helpers
// =============================================================================

/**
 * Normalize LDUser to LDContext format
 */
export function normalizeContext(userOrContext: LDUser | LDContext): LDContext {
  if ('kind' in userOrContext) {
    return userOrContext
  }
  // Convert LDUser to single-kind context
  return {
    kind: 'user',
    key: userOrContext.key,
    ...userOrContext,
  }
}

/**
 * Get the key for a context kind
 */
export function getContextKey(context: LDContext, contextKind: string = 'user'): string | undefined {
  if ('kind' in context) {
    if (context.kind === 'multi') {
      const kindContext = context[contextKind]
      if (kindContext && typeof kindContext === 'object' && 'key' in kindContext) {
        return kindContext.key
      }
      return undefined
    } else if (context.kind === contextKind) {
      return context.key
    }
    return undefined
  }
  // LDUser - treat as 'user' kind
  if (contextKind === 'user') {
    return context.key
  }
  return undefined
}

/**
 * Get an attribute value from a context
 */
export function getContextAttribute(
  context: LDContext,
  attribute: string,
  contextKind: string = 'user'
): LDFlagValue | undefined {
  if ('kind' in context) {
    if (context.kind === 'multi') {
      const kindContext = context[contextKind]
      if (kindContext && typeof kindContext === 'object') {
        if (attribute === 'key') return kindContext.key
        // Check for custom attributes in multi-context
        const custom = (kindContext as Record<string, unknown>).custom as Record<string, LDFlagValue> | undefined
        if (custom && attribute in custom) {
          return custom[attribute]
        }
        return kindContext[attribute] as LDFlagValue | undefined
      }
      return undefined
    } else if (context.kind === contextKind || contextKind === 'user') {
      if (attribute === 'key') return context.key
      // Check for custom attributes in single-kind context (converted from LDUser)
      const custom = (context as Record<string, unknown>).custom as Record<string, LDFlagValue> | undefined
      if (custom && attribute in custom) {
        return custom[attribute]
      }
      // Check direct attributes
      if (attribute in context && attribute !== 'custom' && attribute !== 'kind') {
        return context[attribute] as LDFlagValue | undefined
      }
      return undefined
    }
    return undefined
  }

  // LDUser (no kind property)
  if (contextKind !== 'user') return undefined

  // Check built-in attributes
  if (attribute === 'key') return context.key
  if (attribute in context && attribute !== 'custom' && attribute !== 'privateAttributeNames') {
    return context[attribute as keyof LDUser] as LDFlagValue | undefined
  }

  // Check custom attributes
  if (context.custom && attribute in context.custom) {
    return context.custom[attribute]
  }

  return undefined
}

// =============================================================================
// Bucketing
// =============================================================================

/**
 * Calculate bucket value for a user (0 to BUCKET_SCALE-1)
 */
export function getBucketValue(
  context: LDContext,
  flagKey: string,
  salt: string,
  bucketBy: string = 'key',
  contextKind: string = 'user',
  seed?: number
): number {
  const bucketByValue = getContextAttribute(context, bucketBy, contextKind)
  if (bucketByValue === undefined || bucketByValue === null) {
    return 0
  }

  const bucketByString = String(bucketByValue)
  const prefix = seed !== undefined ? String(seed) : `${flagKey}.${salt}`
  const hashInput = `${prefix}.${bucketByString}`

  // Use murmurHash3 and normalize to bucket range
  const hash = murmurHash3_32(hashInput)
  const bucket = Math.abs(hash) % BUCKET_SCALE

  return bucket
}

/**
 * Select variation index from weighted variations
 */
export function selectVariation(
  bucket: number,
  variations: WeightedVariation[]
): { variationIndex: number; inExperiment: boolean } {
  let sum = 0
  for (const wv of variations) {
    sum += wv.weight
    if (bucket < sum) {
      return {
        variationIndex: wv.variation,
        inExperiment: !wv.untracked,
      }
    }
  }
  // Fallback to last variation
  const last = variations[variations.length - 1]
  return {
    variationIndex: last?.variation ?? 0,
    inExperiment: !last?.untracked,
  }
}

// =============================================================================
// Evaluation Result Builder
// =============================================================================

/**
 * Build evaluation detail result
 */
function buildResult<T extends LDFlagValue>(
  value: T,
  variationIndex: number | null,
  reason: LDEvaluationReason
): LDEvaluationDetail<T> {
  return { value, variationIndex, reason }
}

// =============================================================================
// Flag Evaluation
// =============================================================================

export interface EvaluationContext {
  flagKey: string
  flag: FeatureFlag
  context: LDContext
  defaultValue: LDFlagValue
  getFlag: (key: string) => FeatureFlag | undefined
}

/**
 * Evaluate a feature flag for a given context
 */
export function evaluateFlag(ctx: EvaluationContext): LDEvaluationDetail {
  const { flag, context, defaultValue, getFlag } = ctx

  // Check if flag is explicitly off (on === false, not undefined)
  if (flag.on === false) {
    if (flag.offVariation !== undefined && flag.variations) {
      const value = flag.variations[flag.offVariation]
      return buildResult(value ?? defaultValue, flag.offVariation, { kind: 'OFF' })
    }
    return buildResult(defaultValue, null, { kind: 'OFF' })
  }

  // Flag is on (either explicitly or by default when on is undefined)

  // Check prerequisites
  if (flag.prerequisites && flag.prerequisites.length > 0) {
    const prereqResult = checkPrerequisites(flag.prerequisites, context, getFlag)
    if (prereqResult) {
      if (flag.offVariation !== undefined && flag.variations) {
        const value = flag.variations[flag.offVariation]
        return buildResult(value ?? defaultValue, flag.offVariation, prereqResult)
      }
      return buildResult(defaultValue, null, prereqResult)
    }
  }

  // Check targets (user-specific targeting)
  const targetMatch = checkTargets(flag, context)
  if (targetMatch !== null) {
    const value = flag.variations?.[targetMatch] ?? defaultValue
    return buildResult(value, targetMatch, { kind: 'TARGET_MATCH' })
  }

  // Check rules
  if (flag.rules && flag.rules.length > 0) {
    for (let i = 0; i < flag.rules.length; i++) {
      const rule = flag.rules[i]!
      if (evaluateRule(rule, context)) {
        const result = getVariationFromRule(rule, ctx)
        return buildResult(result.value, result.variationIndex, {
          kind: 'RULE_MATCH',
          ruleIndex: i,
          ruleId: rule.id,
          inExperiment: result.inExperiment,
        })
      }
    }
  }

  // Fallthrough
  return evaluateFallthrough(ctx)
}

/**
 * Check prerequisites
 */
function checkPrerequisites(
  prerequisites: Prerequisite[],
  context: LDContext,
  getFlag: (key: string) => FeatureFlag | undefined
): LDEvaluationReason | null {
  for (const prereq of prerequisites) {
    const prereqFlag = getFlag(prereq.key)
    if (!prereqFlag) {
      return { kind: 'PREREQUISITE_FAILED', prerequisiteKey: prereq.key }
    }

    const prereqResult = evaluateFlag({
      flagKey: prereq.key,
      flag: prereqFlag,
      context,
      defaultValue: null,
      getFlag,
    })

    if (prereqResult.variationIndex !== prereq.variation) {
      return { kind: 'PREREQUISITE_FAILED', prerequisiteKey: prereq.key }
    }
  }
  return null
}

/**
 * Check targets for a match
 */
function checkTargets(flag: FeatureFlag, context: LDContext): number | null {
  // Check regular targets (for 'user' kind)
  if (flag.targets) {
    const userKey = getContextKey(context, 'user')
    if (userKey) {
      for (const target of flag.targets) {
        if (target.values.includes(userKey)) {
          return target.variation
        }
      }
    }
  }

  // Check context targets (for other kinds)
  if (flag.contextTargets) {
    for (const target of flag.contextTargets) {
      const contextKind = target.contextKind ?? 'user'
      const key = getContextKey(context, contextKind)
      if (key && target.values.includes(key)) {
        return target.variation
      }
    }
  }

  return null
}

/**
 * Evaluate a rule against a context
 */
function evaluateRule(rule: FlagRule, context: LDContext): boolean {
  if (!rule.clauses || rule.clauses.length === 0) {
    return true
  }

  // All clauses must match (AND logic)
  for (const clause of rule.clauses) {
    if (!evaluateClause(clause, context)) {
      return false
    }
  }

  return true
}

/**
 * Get variation from a rule (with possible rollout)
 */
function getVariationFromRule(
  rule: FlagRule,
  ctx: EvaluationContext
): { value: LDFlagValue; variationIndex: number; inExperiment: boolean } {
  const { flag, context, defaultValue } = ctx

  if (rule.variation !== undefined) {
    const value = flag.variations?.[rule.variation] ?? defaultValue
    return { value, variationIndex: rule.variation, inExperiment: false }
  }

  if (rule.rollout) {
    return evaluateRollout(rule.rollout, ctx)
  }

  return { value: defaultValue, variationIndex: -1, inExperiment: false }
}

/**
 * Evaluate a rollout
 */
function evaluateRollout(
  rollout: RolloutConfig,
  ctx: EvaluationContext
): { value: LDFlagValue; variationIndex: number; inExperiment: boolean } {
  const { flagKey, flag, context, defaultValue } = ctx
  const salt = flag.salt ?? flagKey

  const bucket = getBucketValue(
    context,
    flagKey,
    salt,
    rollout.bucketBy,
    rollout.contextKind,
    rollout.seed
  )

  const { variationIndex, inExperiment } = selectVariation(bucket, rollout.variations)
  const isExperiment = rollout.kind === 'experiment' && inExperiment

  const value = flag.variations?.[variationIndex] ?? defaultValue
  return { value, variationIndex, inExperiment: isExperiment }
}

/**
 * Evaluate fallthrough
 */
function evaluateFallthrough(ctx: EvaluationContext): LDEvaluationDetail {
  const { flag, defaultValue } = ctx

  // Explicit fallthrough config takes precedence
  if (flag.fallthrough) {
    if (flag.fallthrough.variation !== undefined) {
      const value = flag.variations?.[flag.fallthrough.variation] ?? defaultValue
      return buildResult(value, flag.fallthrough.variation, { kind: 'FALLTHROUGH' })
    }

    if (flag.fallthrough.rollout) {
      const result = evaluateRollout(flag.fallthrough.rollout, ctx)
      return buildResult(result.value, result.variationIndex, {
        kind: 'FALLTHROUGH',
        inExperiment: result.inExperiment,
      })
    }
  }

  // If there's a simple value field (common for test flags), use it
  if (flag.value !== undefined) {
    // If variations exist and value matches one, return the matching index
    if (flag.variations) {
      const valueIndex = flag.variations.indexOf(flag.value)
      if (valueIndex >= 0) {
        return buildResult(flag.value, valueIndex, { kind: 'FALLTHROUGH' })
      }
    }
    return buildResult(flag.value, 0, { kind: 'FALLTHROUGH' })
  }

  // Default to last variation (common convention in LaunchDarkly)
  if (flag.variations && flag.variations.length > 0) {
    const lastIndex = flag.variations.length - 1
    return buildResult(flag.variations[lastIndex] ?? defaultValue, lastIndex, { kind: 'FALLTHROUGH' })
  }

  return buildResult(defaultValue, null, { kind: 'FALLTHROUGH' })
}

/**
 * Evaluate flag with error handling
 */
export function evaluateFlagSafe(ctx: EvaluationContext): LDEvaluationDetail {
  try {
    return evaluateFlag(ctx)
  } catch (error) {
    return buildResult(ctx.defaultValue, null, {
      kind: 'ERROR',
      errorKind: 'EXCEPTION',
    })
  }
}
