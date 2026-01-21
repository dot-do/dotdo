/**
 * Feature Flags
 *
 * Provides feature flag evaluation with targeting rules.
 */

import type {
  FeatureFlagDefinition,
  FeatureFlagRule,
  FeatureFlagCondition,
  EvaluationContext,
  EvaluationResult,
  ExperimentStorage,
} from './types'

/**
 * Create a feature flag manager
 *
 * Manages feature flags with targeting rules for gradual rollouts,
 * user segmentation, and A/B testing.
 *
 * @example
 * ```typescript
 * import { createFlagManager } from '@dotdo/experiments'
 *
 * const flags = createFlagManager(this.state.storage)
 *
 * // Create a flag
 * await flags.create({
 *   key: 'new-checkout',
 *   name: 'New Checkout Flow',
 *   enabled: true,
 *   type: 'boolean',
 *   defaultValue: false,
 *   rules: [
 *     {
 *       id: 'beta-users',
 *       conditions: [{ attribute: 'plan', operator: 'equals', value: 'beta' }],
 *       value: true,
 *       priority: 1,
 *     },
 *     {
 *       id: 'percentage-rollout',
 *       conditions: [],
 *       value: true,
 *       percentage: 10, // 10% of users
 *       priority: 2,
 *     },
 *   ],
 * })
 *
 * // Evaluate flag for a user
 * const result = await flags.evaluate('new-checkout', {
 *   userId: 'user-123',
 *   attributes: { plan: 'beta' },
 * })
 *
 * if (result.value) {
 *   // Show new checkout
 * }
 * ```
 */
export function createFlagManager(
  storage: ExperimentStorage,
  options?: {
    /** Key prefix for flags */
    prefix?: string
  }
) {
  const { prefix = 'flag:' } = options ?? {}

  const getKey = (key: string) => `${prefix}${key}`

  return {
    /**
     * Create or update a feature flag
     */
    create: async (flag: Omit<FeatureFlagDefinition, 'createdAt' | 'updatedAt'>): Promise<FeatureFlagDefinition> => {
      const existing = await storage.get<FeatureFlagDefinition>(getKey(flag.key))
      const now = Date.now()

      const fullFlag: FeatureFlagDefinition = {
        ...flag,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }

      await storage.put(getKey(flag.key), fullFlag)
      return fullFlag
    },

    /**
     * Get a feature flag definition
     */
    get: async (key: string): Promise<FeatureFlagDefinition | undefined> => {
      return storage.get<FeatureFlagDefinition>(getKey(key))
    },

    /**
     * List all feature flags
     */
    list: async (): Promise<FeatureFlagDefinition[]> => {
      const all = await storage.list<FeatureFlagDefinition>({ prefix })
      return [...all.values()]
    },

    /**
     * Delete a feature flag
     */
    delete: async (key: string): Promise<boolean> => {
      return storage.delete(getKey(key))
    },

    /**
     * Enable a feature flag
     */
    enable: async (key: string): Promise<void> => {
      const flag = await storage.get<FeatureFlagDefinition>(getKey(key))
      if (flag) {
        flag.enabled = true
        flag.updatedAt = Date.now()
        await storage.put(getKey(key), flag)
      }
    },

    /**
     * Disable a feature flag
     */
    disable: async (key: string): Promise<void> => {
      const flag = await storage.get<FeatureFlagDefinition>(getKey(key))
      if (flag) {
        flag.enabled = false
        flag.updatedAt = Date.now()
        await storage.put(getKey(key), flag)
      }
    },

    /**
     * Evaluate a feature flag for a context
     */
    evaluate: async <T = unknown>(key: string, context?: EvaluationContext): Promise<EvaluationResult<T>> => {
      const flag = await storage.get<FeatureFlagDefinition>(getKey(key))

      if (!flag) {
        return {
          value: undefined as T,
          found: false,
          evaluatedAt: Date.now(),
        }
      }

      // If flag is disabled, return default
      if (!flag.enabled) {
        return {
          value: flag.defaultValue as T,
          found: true,
          evaluatedAt: Date.now(),
        }
      }

      // Evaluate rules in priority order
      if (flag.rules && flag.rules.length > 0) {
        const sortedRules = [...flag.rules].sort((a, b) => a.priority - b.priority)

        for (const rule of sortedRules) {
          if (matchesRule(rule, context)) {
            // Check percentage rollout
            if (rule.percentage !== undefined && rule.percentage < 100) {
              if (!isInRollout(context?.userId, key, rule.id, rule.percentage)) {
                continue
              }
            }

            return {
              value: rule.value as T,
              matchedRule: rule.id,
              found: true,
              evaluatedAt: Date.now(),
            }
          }
        }
      }

      // Return default value
      return {
        value: flag.defaultValue as T,
        found: true,
        evaluatedAt: Date.now(),
      }
    },

    /**
     * Batch evaluate multiple flags
     */
    evaluateAll: async (
      context?: EvaluationContext
    ): Promise<Record<string, EvaluationResult>> => {
      const flags = await storage.list<FeatureFlagDefinition>({ prefix })
      const results: Record<string, EvaluationResult> = {}

      for (const [fullKey, flag] of flags) {
        const key = fullKey.replace(prefix, '')
        results[key] = await evaluateFlag(flag, context)
      }

      return results
    },
  }
}

/**
 * Evaluate a flag without storage (for in-memory flags)
 */
function evaluateFlag(flag: FeatureFlagDefinition, context?: EvaluationContext): EvaluationResult {
  if (!flag.enabled) {
    return {
      value: flag.defaultValue,
      found: true,
      evaluatedAt: Date.now(),
    }
  }

  if (flag.rules && flag.rules.length > 0) {
    const sortedRules = [...flag.rules].sort((a, b) => a.priority - b.priority)

    for (const rule of sortedRules) {
      if (matchesRule(rule, context)) {
        if (rule.percentage !== undefined && rule.percentage < 100) {
          if (!isInRollout(context?.userId, flag.key, rule.id, rule.percentage)) {
            continue
          }
        }

        return {
          value: rule.value,
          matchedRule: rule.id,
          found: true,
          evaluatedAt: Date.now(),
        }
      }
    }
  }

  return {
    value: flag.defaultValue,
    found: true,
    evaluatedAt: Date.now(),
  }
}

/**
 * Check if a rule matches the evaluation context
 */
function matchesRule(rule: FeatureFlagRule, context?: EvaluationContext): boolean {
  // No conditions means always match
  if (!rule.conditions || rule.conditions.length === 0) {
    return true
  }

  // All conditions must match (AND logic)
  for (const condition of rule.conditions) {
    if (!matchesCondition(condition, context)) {
      return false
    }
  }

  return true
}

/**
 * Check if a condition matches the evaluation context
 */
function matchesCondition(condition: FeatureFlagCondition, context?: EvaluationContext): boolean {
  if (!context) return false

  // Get attribute value from context
  let value: unknown
  if (condition.attribute === 'userId') {
    value = context.userId
  } else if (condition.attribute === 'sessionId') {
    value = context.sessionId
  } else {
    value = context.attributes?.[condition.attribute]
  }

  return matchesOperator(value, condition.operator, condition.value)
}

/**
 * Compare values using operator
 */
function matchesOperator(value: unknown, operator: FeatureFlagCondition['operator'], target: unknown): boolean {
  switch (operator) {
    case 'equals':
      return value === target

    case 'notEquals':
      return value !== target

    case 'contains':
      return String(value).includes(String(target))

    case 'in':
      return Array.isArray(target) && target.includes(value)

    case 'notIn':
      return Array.isArray(target) && !target.includes(value)

    case 'gte':
      return Number(value) >= Number(target)

    case 'lte':
      return Number(value) <= Number(target)

    case 'regex':
      try {
        const regex = new RegExp(String(target))
        return regex.test(String(value))
      } catch {
        return false
      }

    default:
      return value === target
  }
}

/**
 * Check if user is in percentage rollout using consistent hashing
 */
function isInRollout(userId: string | undefined, flagKey: string, ruleId: string, percentage: number): boolean {
  if (!userId) {
    // Use random for anonymous users
    return Math.random() * 100 < percentage
  }

  // Consistent hash for logged-in users
  const hash = hashString(`${userId}:${flagKey}:${ruleId}`)
  const bucket = (hash % 10000) / 100 // 0-99.99
  return bucket < percentage
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
 * Feature flag evaluation helper (convenience function)
 *
 * For simple boolean flags without complex targeting.
 */
export async function FeatureFlag(
  storage: ExperimentStorage,
  key: string,
  context?: EvaluationContext
): Promise<boolean> {
  const manager = createFlagManager(storage)
  const result = await manager.evaluate<boolean>(key, context)
  return result.value ?? false
}
