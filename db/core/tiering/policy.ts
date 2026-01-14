/**
 * Tiering policy evaluation
 *
 * Determines when data should move between tiers based on:
 * - Age-based policies (time since creation)
 * - Access-based policies (access count/frequency)
 * - Custom predicates
 */

import type { StorageTier, TieringPolicy, TierMetadata } from './types'
import { DEFAULT_TIERING_POLICY } from './types'

// ============================================================================
// POLICY EVALUATOR
// ============================================================================

/**
 * PolicyEvaluator - Determines tier transitions
 *
 * @example
 * ```typescript
 * const evaluator = new PolicyEvaluator({
 *   warmAfterMs: 7 * 24 * 60 * 60 * 1000,   // 7 days
 *   coldAfterMs: 30 * 24 * 60 * 60 * 1000,  // 30 days
 * })
 *
 * const targetTier = evaluator.evaluate(metadata)
 * if (targetTier && targetTier !== metadata.tier) {
 *   await store.tierTo(key, targetTier)
 * }
 * ```
 */
export class PolicyEvaluator {
  private policy: TieringPolicy

  constructor(policy?: TieringPolicy) {
    this.policy = { ...DEFAULT_TIERING_POLICY, ...policy }
  }

  /**
   * Get the current policy
   */
  getPolicy(): TieringPolicy {
    return { ...this.policy }
  }

  /**
   * Update the policy
   */
  setPolicy(policy: TieringPolicy): void {
    this.policy = { ...DEFAULT_TIERING_POLICY, ...policy }
  }

  /**
   * Evaluate what tier data should be in
   *
   * @param metadata - Current tier metadata
   * @param now - Current timestamp (defaults to Date.now())
   * @returns Target tier, or null if no change needed
   */
  evaluate(metadata: TierMetadata, now: number = Date.now()): StorageTier | null {
    const currentTier = metadata.tier

    // Check cold tier first (it takes precedence)
    if (this.shouldBeCold(metadata, now)) {
      return currentTier === 'cold' ? null : 'cold'
    }

    // Check warm tier
    if (this.shouldBeWarm(metadata, now)) {
      // Only suggest warm if not already cold (don't promote back)
      if (currentTier === 'hot') {
        return 'warm'
      }
      return null
    }

    // Data should stay in current tier
    return null
  }

  /**
   * Check if data should be in warm tier
   */
  shouldBeWarm(metadata: TierMetadata, now: number = Date.now()): boolean {
    // Custom predicate takes precedence
    if (this.policy.shouldWarm) {
      return this.policy.shouldWarm(metadata)
    }

    // Age-based check
    if (this.policy.warmAfterMs !== undefined) {
      const age = now - metadata.createdAt
      if (age >= this.policy.warmAfterMs) {
        return true
      }
    }

    // Access-based check (high-read data might be promoted to warm for caching)
    if (this.policy.warmAfterAccess !== undefined) {
      if (metadata.accessCount >= this.policy.warmAfterAccess) {
        return true
      }
    }

    return false
  }

  /**
   * Check if data should be in cold tier
   */
  shouldBeCold(metadata: TierMetadata, now: number = Date.now()): boolean {
    // Custom predicate takes precedence
    if (this.policy.shouldCold) {
      return this.policy.shouldCold(metadata)
    }

    // Age-based check
    if (this.policy.coldAfterMs !== undefined) {
      const age = now - metadata.createdAt
      if (age >= this.policy.coldAfterMs) {
        return true
      }
    }

    // Access-based check
    if (this.policy.coldAfterAccess !== undefined) {
      if (metadata.accessCount >= this.policy.coldAfterAccess) {
        return true
      }
    }

    return false
  }

  /**
   * Get time until data should tier to warm (ms)
   *
   * @returns Time in ms, or null if no age-based warm policy
   */
  timeUntilWarm(metadata: TierMetadata, now: number = Date.now()): number | null {
    if (this.policy.warmAfterMs === undefined) {
      return null
    }

    const age = now - metadata.createdAt
    const remaining = this.policy.warmAfterMs - age
    return Math.max(0, remaining)
  }

  /**
   * Get time until data should tier to cold (ms)
   *
   * @returns Time in ms, or null if no age-based cold policy
   */
  timeUntilCold(metadata: TierMetadata, now: number = Date.now()): number | null {
    if (this.policy.coldAfterMs === undefined) {
      return null
    }

    const age = now - metadata.createdAt
    const remaining = this.policy.coldAfterMs - age
    return Math.max(0, remaining)
  }

  /**
   * Get accesses remaining until warm tier
   *
   * @returns Access count remaining, or null if no access-based warm policy
   */
  accessesUntilWarm(metadata: TierMetadata): number | null {
    if (this.policy.warmAfterAccess === undefined) {
      return null
    }

    return Math.max(0, this.policy.warmAfterAccess - metadata.accessCount)
  }

  /**
   * Get accesses remaining until cold tier
   *
   * @returns Access count remaining, or null if no access-based cold policy
   */
  accessesUntilCold(metadata: TierMetadata): number | null {
    if (this.policy.coldAfterAccess === undefined) {
      return null
    }

    return Math.max(0, this.policy.coldAfterAccess - metadata.accessCount)
  }
}

// ============================================================================
// POLICY BUILDERS
// ============================================================================

/**
 * Create an age-based tiering policy
 *
 * @param warmAfterDays - Days until warm tier
 * @param coldAfterDays - Days until cold tier
 */
export function ageBasedPolicy(warmAfterDays: number, coldAfterDays: number): TieringPolicy {
  const msPerDay = 24 * 60 * 60 * 1000
  return {
    warmAfterMs: warmAfterDays * msPerDay,
    coldAfterMs: coldAfterDays * msPerDay,
  }
}

/**
 * Create an access-based tiering policy
 *
 * @param warmAfterAccess - Accesses until warm tier
 * @param coldAfterAccess - Accesses until cold tier
 */
export function accessBasedPolicy(warmAfterAccess: number, coldAfterAccess: number): TieringPolicy {
  return {
    warmAfterAccess,
    coldAfterAccess,
  }
}

/**
 * Create a combined age + access policy
 */
export function combinedPolicy(
  options: {
    warmAfterDays?: number
    coldAfterDays?: number
    warmAfterAccess?: number
    coldAfterAccess?: number
  } = {}
): TieringPolicy {
  const msPerDay = 24 * 60 * 60 * 1000
  return {
    warmAfterMs: options.warmAfterDays !== undefined ? options.warmAfterDays * msPerDay : undefined,
    coldAfterMs: options.coldAfterDays !== undefined ? options.coldAfterDays * msPerDay : undefined,
    warmAfterAccess: options.warmAfterAccess,
    coldAfterAccess: options.coldAfterAccess,
  }
}

/**
 * Create a custom predicate-based policy
 */
export function customPolicy(options: {
  shouldWarm?: (metadata: TierMetadata) => boolean
  shouldCold?: (metadata: TierMetadata) => boolean
}): TieringPolicy {
  return {
    shouldWarm: options.shouldWarm,
    shouldCold: options.shouldCold,
  }
}

// ============================================================================
// PRESET POLICIES
// ============================================================================

/**
 * Preset policies for common use cases
 */
export const PRESET_POLICIES = {
  /**
   * Aggressive tiering for high-volume data
   * - Warm after 1 day
   * - Cold after 7 days
   */
  aggressive: ageBasedPolicy(1, 7),

  /**
   * Standard tiering for general use
   * - Warm after 7 days
   * - Cold after 30 days
   */
  standard: ageBasedPolicy(7, 30),

  /**
   * Conservative tiering for important data
   * - Warm after 30 days
   * - Cold after 90 days
   */
  conservative: ageBasedPolicy(30, 90),

  /**
   * Long-term retention
   * - Warm after 90 days
   * - Cold after 365 days
   */
  longTerm: ageBasedPolicy(90, 365),

  /**
   * Hot-read optimization (access-based)
   * - Keep frequently accessed data in hot
   * - Tier to warm after 1000 accesses
   * - Tier to cold after 10000 accesses
   */
  hotRead: accessBasedPolicy(1000, 10000),

  /**
   * Archive after inactivity
   * - Custom: Tier to cold if no access in 30 days
   */
  archiveOnInactive: customPolicy({
    shouldCold: (metadata: TierMetadata) => {
      const thirtyDays = 30 * 24 * 60 * 60 * 1000
      return Date.now() - metadata.lastAccess > thirtyDays
    },
  }),
} as const

// ============================================================================
// BATCH EVALUATION
// ============================================================================

/**
 * Evaluate multiple items and group by target tier
 */
export function evaluateBatch(
  items: Array<{ key: string; metadata: TierMetadata }>,
  evaluator: PolicyEvaluator,
  now: number = Date.now()
): {
  toWarm: string[]
  toCold: string[]
  noChange: string[]
} {
  const result = {
    toWarm: [] as string[],
    toCold: [] as string[],
    noChange: [] as string[],
  }

  for (const item of items) {
    const targetTier = evaluator.evaluate(item.metadata, now)

    if (targetTier === 'warm') {
      result.toWarm.push(item.key)
    } else if (targetTier === 'cold') {
      result.toCold.push(item.key)
    } else {
      result.noChange.push(item.key)
    }
  }

  return result
}

/**
 * Find items that need tiering from a list
 */
export function findTieringCandidates(
  items: Array<{ key: string; metadata: TierMetadata }>,
  evaluator: PolicyEvaluator,
  options: {
    limit?: number
    targetTier?: StorageTier
  } = {}
): Array<{ key: string; metadata: TierMetadata; targetTier: StorageTier }> {
  const now = Date.now()
  const candidates: Array<{ key: string; metadata: TierMetadata; targetTier: StorageTier }> = []

  for (const item of items) {
    const targetTier = evaluator.evaluate(item.metadata, now)

    if (targetTier !== null) {
      // Filter by target tier if specified
      if (options.targetTier && targetTier !== options.targetTier) {
        continue
      }

      candidates.push({
        key: item.key,
        metadata: item.metadata,
        targetTier,
      })

      // Limit results if specified
      if (options.limit && candidates.length >= options.limit) {
        break
      }
    }
  }

  return candidates
}
