/**
 * Experiment Assignment and Bucketing
 *
 * Provides consistent user-to-variant assignment with persistence.
 */

import type {
  ExperimentDefinition,
  ExperimentVariantDefinition,
  Assignment,
  ExperimentStorage,
  TargetingRule,
} from './types'

/**
 * Create an experiment assignment manager
 *
 * Handles consistent bucketing of users into experiment variants
 * with persistence for sticky assignments.
 *
 * @example
 * ```typescript
 * import { createAssignmentManager } from '@dotdo/experiments'
 *
 * const manager = createAssignmentManager(this.state.storage)
 *
 * // Get or create assignment
 * const variant = await manager.assignVariant('user-123', experiment)
 * console.log(`User assigned to variant: ${variant.id}`)
 *
 * // Check if user is already assigned
 * const existing = await manager.getAssignment('user-123', 'signup-test')
 * ```
 */
export function createAssignmentManager(
  storage: ExperimentStorage,
  options?: {
    /** Key prefix for assignments */
    prefix?: string
  }
) {
  const { prefix = 'exp:assignment:' } = options ?? {}

  const getKey = (userId: string, experimentId: string) => `${prefix}${experimentId}:${userId}`

  return {
    /**
     * Get existing assignment for a user
     */
    getAssignment: async (userId: string, experimentId: string): Promise<Assignment | undefined> => {
      return storage.get<Assignment>(getKey(userId, experimentId))
    },

    /**
     * Assign a user to a variant in an experiment
     *
     * If the user is already assigned, returns the existing assignment.
     * Otherwise, buckets the user based on variant weights.
     */
    assignVariant: async (
      userId: string,
      experiment: ExperimentDefinition,
      context?: Record<string, unknown>
    ): Promise<ExperimentVariantDefinition | null> => {
      // Check for existing assignment
      const existing = await storage.get<Assignment>(getKey(userId, experiment.id))
      if (existing) {
        const variant = experiment.variants.find((v) => v.id === existing.variantId)
        return variant ?? null
      }

      // Check if experiment is active
      if (!experiment.active) {
        return null
      }

      // Check targeting rules
      if (experiment.targeting && !matchesTargeting(userId, experiment.targeting, context)) {
        return null
      }

      // Bucket user into a variant
      const variant = bucketUser(userId, experiment.id, experiment.variants)
      if (!variant) {
        return null
      }

      // Persist assignment
      const assignment: Assignment = {
        userId,
        experimentId: experiment.id,
        variantId: variant.id,
        assignedAt: Date.now(),
        context,
      }
      await storage.put(getKey(userId, experiment.id), assignment)

      return variant
    },

    /**
     * Force assign a user to a specific variant
     *
     * Used for testing or manual overrides.
     */
    forceAssign: async (
      userId: string,
      experimentId: string,
      variantId: string,
      context?: Record<string, unknown>
    ): Promise<Assignment> => {
      const assignment: Assignment = {
        userId,
        experimentId,
        variantId,
        assignedAt: Date.now(),
        context,
      }
      await storage.put(getKey(userId, experimentId), assignment)
      return assignment
    },

    /**
     * Remove assignment for a user
     */
    removeAssignment: async (userId: string, experimentId: string): Promise<boolean> => {
      return storage.delete(getKey(userId, experimentId))
    },

    /**
     * Get all assignments for an experiment
     */
    getExperimentAssignments: async (experimentId: string): Promise<Assignment[]> => {
      const all = await storage.list<Assignment>({ prefix: `${prefix}${experimentId}:` })
      return [...all.values()]
    },

    /**
     * Get all assignments for a user
     */
    getUserAssignments: async (userId: string): Promise<Assignment[]> => {
      // This requires scanning all assignments - expensive operation
      // Consider using a secondary index in production
      const all = await storage.list<Assignment>({ prefix })
      return [...all.values()].filter((a) => a.userId === userId)
    },

    /**
     * Clear all assignments for an experiment
     */
    clearExperimentAssignments: async (experimentId: string): Promise<void> => {
      const all = await storage.list<Assignment>({ prefix: `${prefix}${experimentId}:` })
      const keys = [...all.keys()]
      if (keys.length > 0) {
        await storage.delete(keys)
      }
    },
  }
}

/**
 * Bucket a user into a variant using consistent hashing
 *
 * Uses a hash of (userId, experimentId) to ensure:
 * 1. Same user always gets same variant for same experiment
 * 2. Distribution follows variant weights
 */
function bucketUser(
  userId: string,
  experimentId: string,
  variants: ExperimentVariantDefinition[]
): ExperimentVariantDefinition | null {
  if (variants.length === 0) {
    return null
  }

  // Calculate total weight
  const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0)
  if (totalWeight <= 0) {
    return null
  }

  // Hash user+experiment to get a consistent bucket
  const hash = hashString(`${userId}:${experimentId}`)
  const bucket = (hash % 10000) / 100 // 0-99.99

  // Find variant based on bucket
  let cumulative = 0
  for (const variant of variants) {
    cumulative += (variant.weight / totalWeight) * 100
    if (bucket < cumulative) {
      return variant
    }
  }

  // Fallback to last variant
  return variants[variants.length - 1] ?? null
}

/**
 * Simple string hash function (FNV-1a)
 */
function hashString(str: string): number {
  let hash = 2166136261
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash)
}

/**
 * Check if user matches targeting rules
 */
function matchesTargeting(
  userId: string,
  rules: TargetingRule[],
  context?: Record<string, unknown>
): boolean {
  // All rules must match (AND logic)
  for (const rule of rules) {
    if (!matchesRule(userId, rule, context)) {
      return false
    }
  }
  return true
}

/**
 * Check if user matches a single targeting rule
 */
function matchesRule(userId: string, rule: TargetingRule, context?: Record<string, unknown>): boolean {
  switch (rule.type) {
    case 'percentage': {
      // Use hash to deterministically include/exclude
      const hash = hashString(userId)
      const percentage = (hash % 10000) / 100
      return percentage < (rule.value as number)
    }

    case 'userIds': {
      const userIds = rule.value as string[]
      return userIds.includes(userId)
    }

    case 'attribute': {
      if (!context || !rule.attribute) return false
      const value = context[rule.attribute]
      return matchesOperator(value, rule.operator, rule.value)
    }

    case 'segment': {
      // Segments are pre-defined user groups
      const segments = (context?.['segments'] as string[] | undefined) ?? []
      return segments.includes(rule.value as string)
    }

    default:
      return true
  }
}

/**
 * Compare values using operator
 */
function matchesOperator(value: unknown, operator: string | undefined, target: unknown): boolean {
  switch (operator) {
    case 'equals':
      return value === target
    case 'contains':
      return String(value).includes(String(target))
    case 'in':
      return Array.isArray(target) && target.includes(value)
    case 'gte':
      return Number(value) >= Number(target)
    case 'lte':
      return Number(value) <= Number(target)
    default:
      return value === target
  }
}

/**
 * Assign user to variant (convenience function)
 *
 * Creates a one-off assignment without persistence.
 * Use createAssignmentManager for production use.
 */
export function assignVariant(
  userId: string,
  experimentId: string,
  variants: ExperimentVariantDefinition[]
): ExperimentVariantDefinition | null {
  return bucketUser(userId, experimentId, variants)
}
